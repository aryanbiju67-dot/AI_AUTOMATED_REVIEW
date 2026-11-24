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
type ReviewField = "experience" | "ambience" | "service" | "quality" | "pricing" | "recommend" | "general";
type Tone = "excellent" | "positive" | "average" | "negative";
function pick<T>(items: T[]): T { return items[Math.floor(Math.random() * items.length)]; }
function fieldForQuestion(question: Question): ReviewField {
  const text = question.text.toLowerCase();
  if (/recommend|suggest/.test(text)) return "recommend";
  if (/pricing|price|cost|value for money|afford/.test(text)) return "pricing";
  if (/ambience|ambiance|environment|atmosphere|decor|seating/.test(text)) return "ambience";
  if (/quality|product|food|meal|dish|taste|flavou?r|menu|drink/.test(text)) return "quality";
  if (/service|staff|team|hospitality|support/.test(text)) return "service";
  if (/overall|experience|visit/.test(text)) return "experience";
  return "general";
}
function focusForQuestion(question: Question) {
  const text = question.text.replace(/[?!.,:;]+/g, " ").replace(/\s+/g, " ").trim();
  const known = [
    /value for money/i, /customer service/i, /overall experience/i, /food quality/i, /waiting time|wait time/i,
    /cleanliness|hygiene/i, /ambience|ambiance|atmosphere|environment|decor|seating/i,
    /service|hospitality|support/i, /staff|team|employees?/i, /food|meal|dish|taste|flavou?r|menu|drink|coffee|momos?/i,
    /pricing|price|cost|value/i, /wait|speed|delivery|time/i, /product|quality|purchase|item|selection/i,
    /location|parking|access|area/i, /recommend(?:ation)?/i,
  ];
  for (const pattern of known) {
    const match = text.match(pattern);
    if (match) return match[0].toLowerCase();
  }
  const stopWords = new Set("how what which when where why was were is are did do does you your our the a an and of for to with in on at during about please rate tell me think feel felt would could should this that".split(" "));
  const words = text.toLowerCase().split(/\s+/).filter((word) => !stopWords.has(word));
  return words.slice(0, 3).join(" ") || "overall experience";
}
function toneForAnswer(value: string): Tone | null {
  const normalized = value.trim().toLowerCase();
  if (["excellent", "outstanding", "exceptional"].includes(normalized)) return "excellent";
  if (["very good", "good", "great", "positive", "satisfied", "affordable", "great value for money"].includes(normalized)) return "positive";
  if (["average", "okay", "ok", "fair", "neutral", "not applicable"].includes(normalized)) return "average";
  if (["poor", "bad", "very poor", "negative", "unsatisfied", "expensive"].includes(normalized)) return "negative";
  return null;
}
function chooseUnused(pool: string[], used: Set<string>) {
  const available = pool.filter((phrase) => !used.has(phrase));
  const phrase = pick(available.length ? available : pool);
  used.add(phrase);
  return phrase;
}
function sentenceForRating(focus: string, value: string, used: Set<string>) {
  const subject = `the ${focus}`;
  const pools: Record<Tone, string[]> = {
    excellent: [
      `I was especially impressed by ${subject}.`, `${capitalize(focus)} was a real highlight of my visit.`,
      `I particularly enjoyed ${subject}.`, `The ${focus} exceeded what I expected.`,
      `I came away really pleased with ${subject}.`, `I couldn't have asked for more from ${subject}.`,
      `One of the best parts of my visit was ${subject}.`, `I thought ${subject} was outstanding.`,
      `${capitalize(focus)} made a great impression on me.`, `I left with a very positive impression of ${subject}.`,
      `I was genuinely impressed with ${subject}.`, `I enjoyed every part of ${subject}.`,
    ],
    positive: [
      `I really liked ${subject}.`, `I was happy with ${subject}.`, `${capitalize(focus)} stood out in a good way.`,
      `I had a good experience with ${subject}.`, `I enjoyed ${subject}.`, `I appreciated ${subject}.`,
      `${capitalize(focus)} left a good impression on me.`, `I came away pleased with ${subject}.`,
      `I thought ${subject} was handled well.`, `I was glad to see ${subject} done well.`,
      `I found ${subject} enjoyable.`, `I was satisfied with ${subject}.`,
    ],
    average: [
      `My experience with ${subject} was fairly ordinary.`, `${capitalize(focus)} was okay overall, though nothing especially stood out.`,
      `I had mixed feelings about ${subject}.`, `${capitalize(focus)} was fine, but not particularly memorable.`,
      `I thought ${subject} was acceptable.`, `There was nothing especially remarkable about ${subject}.`,
      `${capitalize(focus)} met the basic expectation, but didn't stand out.`, `I found ${subject} just average overall.`,
      `It was an alright experience with ${subject}.`, `${capitalize(focus)} was neither a highlight nor a major issue for me.`,
      `I was reasonably okay with ${subject}.`, `My impression of ${subject} was somewhere in the middle.`,
    ],
    negative: [
      `I was disappointed with ${subject}.`, `${capitalize(focus)} fell short of what I hoped for.`,
      `${capitalize(focus)} could have been better.`, `I wasn't very satisfied with ${subject}.`,
      `I expected more from ${subject}.`, `${capitalize(focus)} was the weakest part of my visit.`,
      `I left wishing ${subject} had been better.`, `I didn't have a good experience with ${subject}.`,
      `Unfortunately, ${subject} let me down.`, `${capitalize(focus)} didn't meet my expectations.`,
      `I found ${subject} disappointing.`, `There is room for improvement in ${focus}.`,
    ],
  };
  const tone = toneForAnswer(value) ?? "average";
  return chooseUnused(pools[tone], used);
}
function capitalize(value: string) { return value ? value[0].toUpperCase() + value.slice(1) : value; }
function openingFor(name: string, value: string, used: Set<string>) {
  const tone = toneForAnswer(value) ?? "average";
  const pools: Record<Tone, string[]> = {
    excellent: [
      `I had an excellent overall experience at ${name}.`, `I really enjoyed my visit to ${name}.`,
      `My visit to ${name} was a great one.`, `I had a wonderful time at ${name}.`,
      `${name} made a very positive impression on me.`, `I left ${name} feeling very pleased with my visit.`,
      `I had a thoroughly enjoyable visit to ${name}.`, `My experience at ${name} was excellent from start to finish.`,
      `I was really impressed by my visit to ${name}.`, `I would gladly visit ${name} again.`,
      `I had a lovely experience at ${name}.`, `Visiting ${name} was a real pleasure.`,
    ],
    positive: [
      `I had a good experience at ${name}.`, `I enjoyed my visit to ${name}.`,
      `I had a nice time at ${name}.`, `My visit to ${name} went well.`,
      `${name} left me with a positive impression.`, `I was pleased with my visit to ${name}.`,
      `I had a pleasant experience at ${name}.`, `It was nice spending time at ${name}.`,
      `I came away happy with my visit to ${name}.`, `Overall, I enjoyed being at ${name}.`,
      `My time at ${name} was enjoyable.`, `I was glad I stopped by ${name}.`,
    ],
    average: [
      `My visit to ${name} was alright overall.`, `I had an average experience at ${name}.`,
      `My experience at ${name} was mixed.`, `I thought my visit to ${name} was okay.`,
      `My time at ${name} was fairly ordinary.`, `Overall, my visit to ${name} was fine, though not memorable.`,
      `I had a middle-of-the-road experience at ${name}.`, `My visit to ${name} was neither great nor terrible.`,
      `${name} was okay for a visit, but didn't really stand out to me.`, `I left with mixed feelings about ${name}.`,
      `My experience at ${name} was decent overall.`, `I found my visit to ${name} acceptable.`,
    ],
    negative: [
      `I was disappointed with my visit to ${name}.`, `My experience at ${name} fell short of what I expected.`,
      `Unfortunately, my visit to ${name} wasn't a great one.`, `I left ${name} feeling let down.`,
      `My visit to ${name} could have gone better.`, `I didn't enjoy my experience at ${name} as much as I hoped.`,
      `I had a frustrating visit to ${name}.`, `My time at ${name} was disappointing overall.`,
      `I expected a better experience at ${name}.`, `I left ${name} wishing the visit had gone differently.`,
      `My experience at ${name} wasn't what I had hoped for.`, `I can't say my visit to ${name} was satisfying.`,
    ],
  };
  return chooseUnused(pools[tone], used);
}
function sentencesForChoice(question: Question, answer: string, used: Set<string>) {
  const focus = focusForQuestion(question);
  const normalized = answer.trim();
  const optionTone = toneForAnswer(normalized);
  if (optionTone) return sentenceForRating(focus, normalized, used);
  const pools = [
    `I chose ${normalized} for ${focus}.`, `For ${focus}, I went with ${normalized}.`,
    `${normalized} was my choice for ${focus}.`, `When it came to ${focus}, I picked ${normalized}.`,
    `I decided on ${normalized} for ${focus}.`, `I went with ${normalized} when choosing ${focus}.`,
  ];
  return chooseUnused(pools, used);
}
function sentenceForText(value: string, used: Set<string>) {
  const text = value.replace(/[\r\n]+/g, " ").replace(/\s+/g, " ").trim();
  if (!text) return "";
  const normalized = text[0].toUpperCase() + text.slice(1);
  const sentence = /[.!?]$/.test(normalized) ? normalized : `${normalized}.`;
  const wrappers = [sentence, `One thing I wanted to mention: ${sentence}`, `A detail I remember is this: ${sentence}`, `I also noticed this: ${sentence}`];
  return chooseUnused(wrappers, used);
}
function sentenceForAnswer(question: Question, value: string, used: Set<string>) {
  const field = fieldForQuestion(question);
  const focus = focusForQuestion(question);
  const normalized = value.trim();
  const tone = toneForAnswer(normalized);
  if (field === "recommend") {
    const response = normalized.toLowerCase();
    if (["yes", "definitely", "certainly"].includes(response)) return chooseUnused([
      "I would recommend this place to others.", "I'd be happy to recommend this place.",
      `I would gladly suggest ${question.text.toLowerCase().includes("business") ? "this business" : "this place"} to someone else.`,
      "Based on my visit, I would recommend giving this place a try.",
    ], used);
    if (["maybe", "not sure", "unsure"].includes(response)) return chooseUnused([
      "I might recommend it, depending on what someone is looking for.", "I am on the fence about recommending this place.",
      "I could see recommending it to some people, though I'm not certain.",
    ], used);
    if (["no", "not really", "definitely not"].includes(response)) return chooseUnused([
      "I wouldn't recommend it based on my experience.", "I don't think I would recommend this place.",
      "My visit didn't leave me confident recommending it to others.",
    ], used);
  }
  if (field === "pricing") {
    const pricePhrases: Record<string, string[]> = {
      expensive: ["I found the pricing a little high.", "The prices felt a bit steep to me.", "I thought it was on the expensive side.", "The cost was more than I expected.", "I wasn't fully convinced by the value for the price."],
      fair: ["The pricing seemed fair.", "I thought the prices were reasonable.", "The cost felt about right for what I got.", "I found the pricing pretty balanced.", "The value felt fair overall."],
      affordable: ["I found the pricing affordable.", "The prices felt reasonable to me.", "I thought it was good value for the cost.", "The cost felt manageable.", "I was happy with the value for the price."],
      "great value for money": ["I thought it offered great value for money.", "The price felt well worth it to me.", "I was impressed by the value for the cost.", "I felt I got a lot for the price.", "The value for money was a real plus."],
    };
    const pricePhrase = pricePhrases[normalized.toLowerCase()];
    if (pricePhrase) return chooseUnused(pricePhrase, used);
  }
  if (tone) return sentenceForRating(focus, normalized, used);
  if (question.answer_type === "choice") return sentencesForChoice(question, normalized, used);
  const valueSentence = normalized[0].toUpperCase() + normalized.slice(1);
  return /[.!?]$/.test(valueSentence) ? valueSentence : `${valueSentence}.`;
}
function composeReview(page: PublicPage, questions: Question[], answers: Answer[], _language: Language) {
  const used = new Set<string>();
  const answerByQuestion = new Map(answers.map((answer) => [answer.questionId, answer]));
  const primary = answers.find((answer) => {
    const question = questions.find((item) => item.id === answer.questionId);
    return question?.required && question.answer_type === "rating" && fieldForQuestion(question) === "experience";
  });
  const name = page.business.name.trim();
  const intro = primary
    ? openingFor(name, primary.value, used)
    : chooseUnused([
      `I recently visited ${name} and wanted to share a few thoughts.`, `I stopped by ${name} and have a few things to share.`,
      `Here are some thoughts from my visit to ${name}.`, `I wanted to share a little about my visit to ${name}.`,
      `My visit to ${name} left me with a few thoughts.`, `I recently had a chance to visit ${name}.`,
    ], used);
  const review: string[] = [intro];
  for (const question of questions) {
    const answer = answerByQuestion.get(question.id);
    if (!answer || answer === primary) continue;
    if (answer.value.trim().toLowerCase() === "not applicable") continue;
    const sentence = question.answer_type === "text"
      ? sentenceForText(answer.value, used)
      : sentenceForAnswer(question, answer.value, used);
    if (sentence) review.push(sentence);
  }
  return review.join(" ").slice(0, 6000);
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
