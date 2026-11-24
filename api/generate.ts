type Language = "English" | "Hindi" | "Hinglish";
type Question = { id: string; text: string; required: boolean; answer_type: "rating" | "choice" | "text"; options: string[] };
type Answer = { questionId: string; value: string };
type PublicPage = { business: { id: string; name: string; category: string; google_review_url: string }; questions: Question[] };
interface Env { TURNSTILE_SECRET_KEY?: string; SUPABASE_URL?: string; SUPABASE_SECRET_KEY?: string }
interface PagesContext { request: Request; env: Env }
const languages = new Set<Language>(["English", "Hindi", "Hinglish"]);

function json(body: unknown, status = 200) {
  return Response.json(body, { status, headers: { "Cache-Control": "no-store", "X-Content-Type-Options": "nosniff" } });
}
function clientIp(request: Request) {
  return (request.headers.get("CF-Connecting-IP") || request.headers.get("x-vercel-forwarded-for") || request.headers.get("x-forwarded-for"))?.split(",")[0].trim() || null;
}
async function sha256(value: string) {
  const digest = await crypto.subtle.digest("SHA-256", new TextEncoder().encode(value));
  return [...new Uint8Array(digest)].map((byte) => byte.toString(16).padStart(2, "0")).join("");
}
function supabaseServerHeaders(secretKey: string) {
  return {
    apikey: secretKey,
    ...(secretKey.startsWith("sb_secret_") ? {} : { Authorization: `Bearer ${secretKey}` }),
    "Content-Type": "application/json",
  };
}
async function loadPublicPage(env: Env, token: string): Promise<PublicPage | null> {
  if (!env.SUPABASE_URL || !env.SUPABASE_SECRET_KEY) return null;
  const response = await fetch(`${env.SUPABASE_URL.replace(/\/$/, "")}/rest/v1/rpc/get_public_review_page`, {
    method: "POST", headers: supabaseServerHeaders(env.SUPABASE_SECRET_KEY),
    body: JSON.stringify({ p_token_hash: await sha256(token) }), signal: AbortSignal.timeout(3500),
  });
  if (!response.ok) return null;
  return await response.json() as PublicPage | null;
}
async function checkGenerationLimit(env: Env, token: string, request: Request) {
  const ip = clientIp(request);
  if (!ip || !env.SUPABASE_URL || !env.SUPABASE_SECRET_KEY) return false;
  const bucketKey = await sha256(`${ip}:${token}`);
  const response = await fetch(`${env.SUPABASE_URL.replace(/\/$/, "")}/rest/v1/rpc/check_public_rate_limit`, {
    method: "POST", headers: supabaseServerHeaders(env.SUPABASE_SECRET_KEY),
    body: JSON.stringify({ p_bucket_key: bucketKey, p_limit: 8, p_window_seconds: 3600 }), signal: AbortSignal.timeout(2500),
  });
  if (!response.ok) throw new Error("The review request limit could not be checked.");
  return await response.json() === true;
}
async function verifyTurnstile(secret: string, token: string, request: Request) {
  if (!token || token.length > 2048) return false;
  const form = new URLSearchParams({ secret, response: token });
  const ip = clientIp(request);
  if (ip) form.set("remoteip", ip);
  try {
    const response = await fetch("https://challenges.cloudflare.com/turnstile/v0/siteverify", { method: "POST", body: form, signal: AbortSignal.timeout(2500) });
    return response.ok && (await response.json() as { success?: boolean }).success === true;
  } catch { return false; }
}
function validateAnswers(value: unknown, questions: Question[]): Answer[] | null {
  if (!Array.isArray(value) || value.length > questions.length) return null;
  const provided = new Map<string, string>();
  for (const entry of value) {
    if (!entry || typeof entry !== "object") return null;
    const answer = entry as Partial<Answer>;
    if (typeof answer.questionId !== "string" || typeof answer.value !== "string" || provided.has(answer.questionId)) return null;
    provided.set(answer.questionId, answer.value.trim());
  }
  const known = new Set(questions.map((question) => question.id));
  if ([...provided.keys()].some((id) => !known.has(id))) return null;
  const answers: Answer[] = [];
  for (const question of questions) {
    const value = provided.get(question.id);
    if (!value) {
      if (question.required) return null;
      continue;
    }
    if (question.answer_type === "rating" && !["Good", "Poor", "Average", "Excellent"].includes(value)) return null;
    if (question.answer_type === "choice" && !question.options.includes(value)) return null;
    if (question.answer_type === "text" && (value.length > 160 || value.length < 2)) return null;
    answers.push({ questionId: question.id, value });
  }
  return answers;
}
type ReviewField = "experience" | "ambience" | "service" | "quality" | "pricing" | "recommend";
function pick<T>(items: T[]): T { return items[Math.floor(Math.random() * items.length)]; }
function fieldForQuestion(question: Question): ReviewField | null {
  const text = question.text.toLowerCase();
  if (/recommend|would you suggest/.test(text)) return "recommend";
  if (/pricing|price|cost|value for money|afford/.test(text)) return "pricing";
  if (/ambience|ambiance|environment|atmosphere/.test(text)) return "ambience";
  if (/quality|product|food|meal|dish/.test(text)) return "quality";
  if (/service|staff|team|hospitality/.test(text)) return "service";
  if (/overall|experience|visit/.test(text)) return "experience";
  return null;
}
function composeReview(page: PublicPage, questions: Question[], answers: Answer[], _language: Language) {
  const selections: Partial<Record<ReviewField, string>> = {};
  const additional: string[] = [];
  for (const answer of answers) {
    const question = questions.find((item) => item.id === answer.questionId);
    if (!question) continue;
    if (question.answer_type === "text") {
      if (answer.value.trim()) additional.push(answer.value.trim());
      continue;
    }
    const field = fieldForQuestion(question);
    const value = answer.value.trim();
    const ratingValue = ["Poor", "Average", "Good", "Very good", "Excellent"].includes(value) || (field === "quality" && value === "Not applicable");
    const pricingValue = ["Expensive", "Fair", "Affordable", "Great value for money"].includes(value);
    const recommendationValue = ["Yes", "Maybe", "No"].includes(value);
    const matchesSourceQuestion = question.answer_type === "rating"
      ? Boolean(field && field !== "pricing" && field !== "recommend" && ratingValue)
      : field === "pricing" ? pricingValue
        : field === "recommend" ? recommendationValue
          : Boolean(field && ["experience", "ambience", "service", "quality"].includes(field) && ratingValue);
    if (field && matchesSourceQuestion && selections[field] === undefined) selections[field] = value;
  }
  const name = page.business.name.trim();
  const experience = selections.experience;
  const requiredOpening = experience ? [`My experience at ${name} was ${experience.toLowerCase()}.`] : [];
  const openings = [
    `I recently visited ${name} and wanted to share my experience.`,
    ...requiredOpening,
    `I had the opportunity to visit ${name} and here's my feedback.`,
  ];
  const positiveAmbience = [
    "The atmosphere was pleasant.",
    "I enjoyed the overall environment.",
    "The ambience added to my experience.",
  ];
  const negativeAmbience = [
    "The ambience could use some improvement.",
    "The environment wasn't quite what I expected.",
    "There is some room for improvement in the atmosphere.",
  ];
  const positiveService = [
    "The service was impressive.",
    "I appreciated the attention and service.",
    "The staff experience was a highlight.",
  ];
  const negativeService = [
    "The service could have been better.",
    "There is room for improvement in the service.",
    "I felt the service could have been more attentive.",
  ];
  const positiveQuality = [
    "I was happy with the quality.",
    "The quality met my expectations.",
    "I enjoyed the quality of the offering.",
  ];
  const negativeQuality = [
    "The quality could be improved.",
    "I expected a little more in terms of quality.",
    "There is room for improvement in this area.",
  ];
  const pricingText: Record<string, string> = {
    Expensive: "I found the pricing a little on the expensive side.",
    Fair: "The pricing seemed fair.",
    Affordable: "I found the pricing affordable.",
    "Great value for money": "I thought it offered great value for money.",
  };
  const recommendationText: Record<string, string> = {
    Yes: "I would recommend giving this place a visit.",
    Maybe: "I might consider visiting again.",
    No: "Based on my experience, I wouldn't recommend it at this point.",
  };
  const review: string[] = [pick(openings)];
  const ambience = selections.ambience;
  if (ambience === "Poor" || ambience === "Average") review.push(pick(negativeAmbience));
  else if (ambience && ambience !== "Not applicable") review.push(pick(positiveAmbience));
  const service = selections.service;
  if (service) review.push(service === "Poor" || service === "Average" ? pick(negativeService) : pick(positiveService));
  const quality = selections.quality;
  if (quality && quality !== "Not applicable") review.push(quality === "Poor" || quality === "Average" ? pick(negativeQuality) : pick(positiveQuality));
  const pricing = selections.pricing;
  if (pricing && pricingText[pricing]) review.push(pricingText[pricing]);
  const recommendation = selections.recommend;
  if (recommendation && recommendationText[recommendation]) review.push(recommendationText[recommendation]);
  review.push(...additional);
  return review.filter(Boolean).join(" ").slice(0, 6000);
}
export async function onRequestPost({ request, env }: PagesContext) {
  const origin = request.headers.get("Origin");
  if (origin && new URL(origin).host !== new URL(request.url).host) return json({ error: "Request not allowed." }, 403);
  const length = Number(request.headers.get("Content-Length") || 0);
  if (length > 9000) return json({ error: "Request too large." }, 413);
  let body: unknown;
  try { body = await request.json(); } catch { return json({ error: "Invalid request." }, 400); }
  if (!body || typeof body !== "object") return json({ error: "Invalid request." }, 400);
  const input = body as { token?: unknown; language?: unknown; answers?: unknown; turnstileToken?: unknown };
  if (typeof input.token !== "string" || !/^[A-Za-z0-9_-]{28,40}$/.test(input.token)) return json({ error: "This QR code is not active." }, 404);
  let page: PublicPage | null;
  try { page = await loadPublicPage(env, input.token); } catch { return json({ error: "The business configuration could not be loaded." }, 503); }
  if (!page?.business || !Array.isArray(page.questions) || !page.questions.length) return json({ error: "This QR code is not active." }, 404);
  if (typeof input.language !== "string" || !languages.has(input.language as Language)) return json({ error: "Choose a supported language." }, 400);
  const language = input.language as Language;
  const answers = validateAnswers(input.answers, page.questions);
  if (!answers) return json({ error: "Please check the required answers and try again." }, 400);
  const verified = env.TURNSTILE_SECRET_KEY
    ? await verifyTurnstile(env.TURNSTILE_SECRET_KEY, typeof input.turnstileToken === "string" ? input.turnstileToken : "", request)
    : true;
  if (env.TURNSTILE_SECRET_KEY && !verified) return json({ error: "Please complete the security check and try again." }, 403);
  let withinLimit: boolean;
  try { withinLimit = await checkGenerationLimit(env, input.token, request); }
  catch { return json({ error: "Review drafts are temporarily unavailable. Please try again shortly." }, 503); }
  if (!withinLimit) return json({ error: "Too many drafts were requested from this QR code. Please try again later." }, 429);
  return json({ draft: composeReview(page, page.questions, answers, language), source: "local", googleReviewUrl: page.business.google_review_url });
}
const vercelEnv: Env = {
  SUPABASE_URL: process.env.SUPABASE_URL,
  SUPABASE_SECRET_KEY: process.env.SUPABASE_SECRET_KEY,
  TURNSTILE_SECRET_KEY: process.env.TURNSTILE_SECRET_KEY,
};

export function POST(request: Request) {
  return onRequestPost({ request, env: vercelEnv });
}
