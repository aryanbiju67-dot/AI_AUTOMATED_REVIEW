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
type Topic = "food" | "service" | "staff" | "cleanliness" | "value" | "speed" | "ambience" | "product" | "location" | "overall" | "general";
const topicMatchers: Array<[Topic, RegExp]> = [
  ["food", /food|meal|dish|taste|flavou?r|menu|drink|coffee|snack|खाना|भोजन|स्वाद|खाने|chai|khana|taste|coffee/i],
  ["staff", /staff|team|owner|employee|host|reception|personnel|कर्मचारी|स्टाफ|व्यवहार|staff/i],
  ["service", /service|hospitality|support|experience|सेवा|अनुभव|व्यवस्था|service/i],
  ["cleanliness", /clean|hygiene|washroom|bathroom|साफ|सफाई|स्वच्छता|clean/i],
  ["value", /price|cost|value|money|afford|महंगा|कीमत|पैसा|दाम|value/i],
  ["speed", /wait|speed|quick|fast|delivery|time|जल्दी|इंतजार|समय|delivery/i],
  ["ambience", /ambience|atmosphere|environment|decor|seating|comfort|वातावरण|माहौल|बैठने|सजावट/i],
  ["product", /product|quality|purchase|item|selection|प्रोडक्ट|गुणवत्ता|सामान|वस्तु/i],
  ["location", /location|parking|access|area|place|जगह|स्थान|पार्किंग|आसपास/i],
  ["overall", /overall|visit|recommend|विजिट|कुल मिलाकर|overall/i],
];
const hindiPhrases: Record<Topic, Record<"Good" | "Average" | "Bad", string[]>> = {
  food: { Good: ["खाना स्वादिष्ट था", "मुझे खाना बहुत पसंद आया", "खाने का स्वाद अच्छा था"], Average: ["खाना ठीक था", "खाना अच्छा था, पर खास नहीं", "खाने का अनुभव औसत रहा"], Bad: ["खाना मेरी उम्मीद के मुताबिक नहीं था", "खाने में सुधार की गुंजाइश है", "मुझे खाना पसंद नहीं आया"] },
  service: { Good: ["सेवा अच्छी और ध्यान देने वाली थी", "सेवा से मेरा अनुभव बेहतर रहा", "मुझे अच्छी सेवा मिली"], Average: ["सेवा ठीक थी", "सेवा में थोड़ा सुधार हो सकता है", "सेवा का अनुभव सामान्य रहा"], Bad: ["सेवा से मैं निराश हुआ", "सेवा में सुधार की जरूरत है", "सेवा का अनुभव अच्छा नहीं रहा"] },
  staff: { Good: ["स्टाफ का व्यवहार अच्छा था", "स्टाफ ने अच्छे से मदद की", "टीम का व्यवहार मुझे पसंद आया"], Average: ["स्टाफ का व्यवहार ठीक था", "टीम का अनुभव सामान्य रहा", "स्टाफ के व्यवहार में थोड़ा सुधार हो सकता है"], Bad: ["स्टाफ का व्यवहार अच्छा नहीं लगा", "मुझे स्टाफ से बेहतर सहयोग की उम्मीद थी", "टीम का व्यवहार निराशाजनक था"] },
  cleanliness: { Good: ["जगह साफ-सुथरी थी", "सफाई अच्छी लगी", "जगह का रखरखाव अच्छा था"], Average: ["सफाई ठीक थी", "सफाई में थोड़ा सुधार हो सकता है", "जगह का रखरखाव सामान्य था"], Bad: ["सफाई में सुधार की जरूरत है", "जगह उतनी साफ नहीं लगी", "रखरखाव से मैं निराश हुआ"] },
  value: { Good: ["कीमत के हिसाब से अनुभव अच्छा था", "मुझे यह पैसे के लायक लगा", "कीमत उचित लगी"], Average: ["कीमत के हिसाब से अनुभव ठीक था", "कीमत सामान्य लगी", "पैसे के हिसाब से यह ठीक था"], Bad: ["कीमत के हिसाब से अनुभव अच्छा नहीं लगा", "मुझे यह पैसे के लायक नहीं लगा", "कीमत थोड़ी ज्यादा लगी"] },
  speed: { Good: ["काम जल्दी हो गया", "मुझे ज्यादा इंतजार नहीं करना पड़ा", "सब कुछ समय पर हुआ"], Average: ["इंतजार ठीक-ठाक था", "काम में थोड़ा समय लगा", "समय का अनुभव सामान्य था"], Bad: ["मुझे काफी इंतजार करना पड़ा", "काम उम्मीद से धीमा था", "देरी से मेरा अनुभव खराब हुआ"] },
  ambience: { Good: ["जगह का माहौल अच्छा था", "वातावरण आरामदायक था", "मुझे यहां का माहौल पसंद आया"], Average: ["माहौल ठीक था", "वातावरण सामान्य था", "माहौल में थोड़ा सुधार हो सकता है"], Bad: ["माहौल आरामदायक नहीं था", "वातावरण में सुधार की जरूरत है", "जगह का माहौल अच्छा नहीं लगा"] },
  product: { Good: ["गुणवत्ता अच्छी थी", "मैं गुणवत्ता से खुश था", "सामान की गुणवत्ता पसंद आई"], Average: ["गुणवत्ता ठीक थी", "सामान का अनुभव सामान्य रहा", "गुणवत्ता में थोड़ा सुधार हो सकता है"], Bad: ["गुणवत्ता उम्मीद से कम थी", "मैं सामान से निराश हुआ", "गुणवत्ता में सुधार की जरूरत है"] },
  location: { Good: ["जगह आसानी से मिल गई", "लोकेशन सुविधाजनक थी", "यहां पहुंचना आसान था"], Average: ["लोकेशन ठीक थी", "यहां पहुंचना संभालने लायक था", "जगह सामान्य थी"], Bad: ["यहां पहुंचना मुश्किल था", "लोकेशन मेरे लिए सुविधाजनक नहीं थी", "जगह ढूंढने में परेशानी हुई"] },
  overall: { Good: ["कुल मिलाकर मेरा अनुभव अच्छा रहा", "मैं यहां आकर खुश था", "मैं दोबारा आना चाहूंगा"], Average: ["कुल मिलाकर अनुभव ठीक रहा", "मेरा अनुभव मिला-जुला रहा", "कुछ चीजें बेहतर हो सकती थीं"], Bad: ["कुल मिलाकर मैं निराश हुआ", "मेरा अनुभव उम्मीद के मुताबिक नहीं था", "यहां काफी सुधार की जरूरत है"] },
  general: { Good: ["इस बात से मैं खुश था", "यह अनुभव अच्छा रहा", "यह हिस्सा मुझे पसंद आया"], Average: ["यह हिस्सा ठीक था", "इसमें थोड़ा सुधार हो सकता है", "यह अनुभव सामान्य रहा"], Bad: ["इस बात से मैं निराश हुआ", "इसमें सुधार की जरूरत है", "यह हिस्सा अच्छा नहीं लगा"] },
};
const hinglishPhrases: Record<Topic, Record<"Good" | "Average" | "Bad", string[]>> = {
  food: { Good: ["Khana tasty tha", "Mujhe khana kaafi pasand aaya", "Food ka taste achha tha"], Average: ["Khana theek tha", "Food achha tha, par kuch khaas nahi", "Khaane ka experience average raha"], Bad: ["Khana expectations jaisa nahi tha", "Food mein improvement ho sakta hai", "Mujhe khana pasand nahi aaya"] },
  service: { Good: ["Service achhi aur attentive thi", "Service ki wajah se visit pleasant raha", "Mujhe achhi service mili"], Average: ["Service theek thi", "Service mein thoda improvement ho sakta hai", "Service ka experience average raha"], Bad: ["Service se disappointment hui", "Service ko improve karne ki zaroorat hai", "Service ka experience achha nahi raha"] },
  staff: { Good: ["Staff ka behaviour achha tha", "Staff ne achhe se help ki", "Team ka behaviour mujhe pasand aaya"], Average: ["Staff ka behaviour theek tha", "Team ka experience normal raha", "Staff behaviour mein thoda improvement ho sakta hai"], Bad: ["Staff ka behaviour achha nahi laga", "Mujhe staff se better support ki expectation thi", "Team ka behaviour disappointing tha"] },
  cleanliness: { Good: ["Jagah saaf-suthri thi", "Cleanliness achhi lagi", "Place ka maintenance achha tha"], Average: ["Cleanliness theek thi", "Safai mein thoda improvement ho sakta hai", "Maintenance average tha"], Bad: ["Cleanliness improve karne ki zaroorat hai", "Jagah utni clean nahi lagi", "Maintenance disappointing tha"] },
  value: { Good: ["Price ke hisaab se experience achha tha", "Mujhe paisa vasool laga", "Price reasonable thi"], Average: ["Price ke hisaab se experience theek tha", "Cost normal lagi", "Value average thi"], Bad: ["Price ke hisaab se experience achha nahi laga", "Mujhe paisa vasool nahi laga", "Cost thodi zyada lagi"] },
  speed: { Good: ["Kaam jaldi ho gaya", "Zyada wait nahi karna pada", "Sab kuch time par hua"], Average: ["Wait manageable tha", "Kaam mein thoda time laga", "Timing average thi"], Bad: ["Kaafi wait karna pada", "Kaam expectation se slow tha", "Delay ki wajah se experience kharab hua"] },
  ambience: { Good: ["Jagah ka atmosphere achha tha", "Environment comfortable tha", "Mujhe yahan ka ambience pasand aaya"], Average: ["Atmosphere theek tha", "Environment normal tha", "Ambience mein thoda improvement ho sakta hai"], Bad: ["Atmosphere comfortable nahi tha", "Environment improve ho sakta hai", "Ambience achha nahi laga"] },
  product: { Good: ["Quality achhi thi", "Main quality se khush tha", "Product quality pasand aayi"], Average: ["Quality theek thi", "Product experience average tha", "Quality mein thoda improvement ho sakta hai"], Bad: ["Quality expectation se kam thi", "Product se disappointment hui", "Quality improve karne ki zaroorat hai"] },
  location: { Good: ["Location convenient thi", "Yahan aana easy tha", "Location mere liye sahi thi"], Average: ["Location theek thi", "Yahan aana manageable tha", "Location normal thi"], Bad: ["Yahan aana inconvenient tha", "Location mere liye easy nahi thi", "Jagah dhoondhne mein problem hui"] },
  overall: { Good: ["Overall experience achha raha", "Visit karke achha laga", "Main dobara aana chahunga"], Average: ["Overall experience theek tha", "Mera experience mixed raha", "Kuch cheezein better ho sakti thi"], Bad: ["Overall disappointment hui", "Experience expectations jaisa nahi tha", "Kaafi improvement ki zaroorat hai"] },
  general: { Good: ["Is part se main khush tha", "Yeh experience achha raha", "Yeh cheez mujhe pasand aayi"], Average: ["Yeh part theek tha", "Isme thoda improvement ho sakta hai", "Yeh experience normal tha"], Bad: ["Is part se disappointment hui", "Isme improvement ki zaroorat hai", "Yeh cheez achhi nahi lagi"] },
};
function pick<T>(items: T[]): T { return items[Math.floor(Math.random() * items.length)]; }
function topicFor(question: Question): Topic {
  const match = topicMatchers.find(([, pattern]) => pattern.test(question.text));
  return match?.[0] ?? "general";
}
function tidyAnswer(value: string) { return value.replace(/[\r\n]+/g, " ").replace(/\s+/g, " ").trim().replace(/[.!?]+$/, ""); }
function focusForQuestion(question: Question) {
  const text = question.text.replace(/[?!.,:;]+/g, " ").replace(/\s+/g, " ").trim();
  const knownFocuses = [
    /overall experience|overall visit/i, /value for money/i, /customer service/i, /food quality/i, /waiting time|wait time/i,
    /cleanliness|hygiene/i, /ambience|atmosphere|environment/i, /service|hospitality|support/i, /staff|team|employees?/i,
    /food|meal|dish|taste|flavou?r|menu|drink|coffee|momos?/i, /price|cost|value|money/i, /wait|speed|delivery|time/i,
    /product|quality|purchase|item|selection/i, /location|parking|access|area/i, /recommend(?:ation)?/i,
  ];
  for (const pattern of knownFocuses) {
    const match = text.match(pattern);
    if (match) return match[0].toLowerCase();
  }
  const stopWords = new Set("how what which when where why was were is are did do does you your our the a an and of for to with in on at during about please rate describe tell me think feel felt would could should this that".split(" "));
  const words = text.toLowerCase().split(/\s+/).filter((word) => !stopWords.has(word));
  return words.slice(0, 3).join(" ") || "overall experience";
}
function ratingSentiment(value: string): "Good" | "Average" | "Bad" | null {
  const normalized = value.toLowerCase();
  if (["excellent", "very good", "good"].includes(normalized)) return "Good";
  if (["poor", "bad", "very poor"].includes(normalized)) return "Bad";
  if (["average", "okay", "ok", "neutral"].includes(normalized)) return "Average";
  return null;
}
function englishRatingPhrase(focus: string, value: string) {
  const subject = `the ${focus}`;
  if (value.toLowerCase() === "excellent") return pick([
    `I was especially impressed with ${subject}.`, `${capitalize(focus)} was a real highlight for me.`, `I really enjoyed ${subject}.`,
  ]);
  const sentiment = ratingSentiment(value);
  if (sentiment === "Good") return pick([
    `I was happy with ${subject}.`, `I really liked ${subject}.`, `${capitalize(focus)} stood out in a good way.`,
  ]);
  if (sentiment === "Bad") return pick([
    `I was disappointed with ${subject}.`, `${capitalize(focus)} could have been better.`, `I wasn't fully satisfied with ${subject}.`,
  ]);
  return pick([
    `My experience with ${subject} was fairly ordinary.`, `${capitalize(focus)} was okay overall, though it didn't stand out.`, `I had mixed feelings about ${subject}.`,
  ]);
}
function capitalize(value: string) { return value ? value[0].toUpperCase() + value.slice(1) : value; }
function englishOverallOpening(name: string, focus: string, value: string) {
  const subject = focus.startsWith("the ") ? focus : `the ${focus}`;
  const sentiment = ratingSentiment(value);
  if (/overall experience|overall visit|experience|visit/i.test(focus)) {
    if (value.toLowerCase() === "excellent") return pick([`My overall experience at ${name} was excellent.`, `I had an excellent visit to ${name}.`, `I really enjoyed my time at ${name}.`]);
    if (sentiment === "Good") return pick([`My overall experience at ${name} was good.`, `I had a really nice visit to ${name}.`, `I enjoyed my visit to ${name}.`]);
    if (sentiment === "Bad") return pick([`My overall experience at ${name} was disappointing.`, `I left ${name} disappointed.`, `My visit to ${name} fell short of what I expected.`]);
    return pick([`My overall experience at ${name} was average.`, `My visit to ${name} was alright overall.`, `I had mixed feelings about my visit to ${name}.`]);
  }
  if (value.toLowerCase() === "excellent") return pick([`I was especially impressed with ${subject} at ${name}.`, `${capitalize(focus)} was a highlight of my visit to ${name}.`]);
  if (sentiment === "Good") return pick([`I was pleased with ${subject} at ${name}.`, `I had a good experience with ${subject} at ${name}.`]);
  if (sentiment === "Bad") return pick([`I was disappointed with ${subject} at ${name}.`, `${capitalize(focus)} at ${name} could have been better.`]);
  return pick([`My experience with ${subject} at ${name} was fairly ordinary.`, `${capitalize(focus)} at ${name} was okay, though it didn't stand out.`]);
}
function composeReview(page: PublicPage, questions: Question[], answers: Answer[], language: Language) {
  const primaryRating = answers.find((answer) => {
    const question = questions.find((item) => item.id === answer.questionId);
    return question?.required && question.answer_type === "rating";
  });
  const phrases = answers.filter((answer) => answer !== primaryRating).map((answer) => {
    const question = questions.find((item) => item.id === answer.questionId)!;
    const detail = tidyAnswer(answer.value);
    const topic = topicFor(question);
    const focus = focusForQuestion(question);
    if (question.answer_type === "text") {
      const statement = capitalize(detail);
      if (language === "Hindi") return `एक बात जो मुझे याद रही: ${statement}।`;
      if (language === "Hinglish") return `Ek baat jo mujhe yaad rahi: ${statement}.`;
      return pick([`One detail that stuck with me: ${statement}.`, `I also noticed this: ${statement}.`]);
    }
    const sentiment = ratingSentiment(detail);
    if (sentiment) {
      if (language === "English") return englishRatingPhrase(focus, detail);
      const bank = language === "Hindi" ? hindiPhrases : hinglishPhrases;
      return pick(bank[topic][sentiment]);
    }
    if (question.answer_type === "choice") {
      if (language === "Hindi") return `मैंने ${focus} के लिए ${detail} चुना।`;
      if (language === "Hinglish") return `Maine ${focus} ke liye ${detail} choose kiya.`;
      return pick([`I chose ${detail} for ${focus}.`, `For ${focus}, I went with ${detail}.`, `${detail} was my choice for ${focus}.`]);
    }
    return detail;
  }).filter(Boolean);
  if (phrases.length === 0 && !primaryRating) return "";
  const name = page.business.name.trim();
  if (language === "English") {
    const primaryQuestion = primaryRating && questions.find((question) => question.id === primaryRating.questionId);
    const start = primaryRating && primaryQuestion
      ? englishOverallOpening(name, focusForQuestion(primaryQuestion), primaryRating.value)
      : pick([`A few things stood out during my visit to ${name}.`, `Here are a few things from my visit to ${name}.`, `During my visit to ${name}, I noticed a few things.`]);
    let review = [start, ...phrases].filter(Boolean).join(" ");
    return `${review.replace(/\s+/g, " ").replace(/([.!?])\s*([a-z])/g, (_m, p, c) => `${p} ${c.toUpperCase()}`).replace(/[.!?]*$/, ".")}`.slice(0, 6000);
  }
  const separator = language === "Hindi" ? "। " : ". ";
  const rating = primaryRating?.value.toLowerCase();
  const opening = language === "Hindi"
    ? rating === "excellent" ? [`${name} में मेरा अनुभव शानदार रहा।`, `${name} में बहुत अच्छा अनुभव रहा।`]
      : rating === "good" ? [`${name} में मेरा अनुभव अच्छा रहा।`, `${name} आकर अच्छा लगा।`]
        : rating === "average" ? [`${name} का मेरा अनुभव ठीक-ठाक रहा।`, `${name} में अनुभव मिला-जुला रहा।`]
          : rating === "poor" || rating === "bad" ? [`${name} में मेरा अनुभव निराशाजनक रहा।`, `${name} से मुझे बेहतर अनुभव की उम्मीद थी।`]
            : [`${name} में मेरा अनुभव ऐसा रहा:`, ""]
    : rating === "excellent" ? [`${name} mein mera experience excellent raha.`, `${name} par time spend karke kaafi achha laga.`]
      : rating === "good" ? [`${name} mein mera experience achha raha.`, `${name} visit karke achha laga.`]
        : rating === "average" ? [`${name} ka experience theek-thaak raha.`, `${name} mein mera experience mixed raha.`]
          : rating === "poor" || rating === "bad" ? [`${name} mein mera experience disappointing raha.`, `${name} se mujhe better experience ki expectation thi.`]
            : [`${name} mein mera experience aisa raha:`, "Overall, "];
  const start = pick(opening);
  const details = phrases.length ? `${start ? `${start} ` : ""}${phrases.join(separator)}${language === "Hindi" ? "।" : "."}` : start;
  return details.slice(0, 6000);
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
