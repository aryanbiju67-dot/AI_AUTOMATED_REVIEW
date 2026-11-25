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
const topicMatchers: Array<[RegExp, string]> = [
  [/\b(food|meal|dish|taste|flavou?r|menu|drink|coffee|momos?|cuisine|delicious|tasty|flavou?rful|spicy|crispy|pasta|pizza|burgers?|sandwich(?:es)?|noodles?|rice|soup|dessert|snacks?|bread|chicken|mutton|paneer|fries|salad)\b/, "food"],
  [/\b(service|hospitality|customer service|support)\b/, "service"],
  [/\b(staff|team|employees?|personnel|people|server|waiter|waitress|stylist|barber|trainer|coach|instructors?|mechanic|technician|doctor)\b/, "staff"],
  [/\b(cleanliness|clean|hygiene|sanitation)\b/, "cleanliness"],
  [/\b(ambience|ambiance|environment|atmosphere|decor|seating)\b/, "atmosphere"],
  [/\b(pricing|price|cost|value for money|affordability|affordable|expensive|overpriced|cheap|inexpensive|rates?|fees?|bill|billing)\b/, "value for money"],
  [/\b(waiting time|wait time|wait|speed|delivery time)\b/, "wait time"],
  [/\b(equipments?|machines?|gym gear|apparatus|treadmills?|dumbbells?|weights?|exercise bikes?|ellipticals?|barbells?|kettlebells?|rowing machines?|stationary bikes?|benches|racks)\b/, "equipment"],
  [/\b(facilities|facility|amenities|premises|pool|court)\b/, "facilities"],
  [/\b(products?|items?|selection|product quality|stock|range)\b/, "products"],
  [/\b(location|parking|access|area)\b/, "location"],
  [/\b(appointment|booking|reservation|schedule)\b/, "booking"],
  [/\b(care|treatment|consultation|diagnosis)\b/, "care"],
  [/\b(repair|workmanship|maintenance|installation)\b/, "work quality"],
  [/\b(communication|response|information)\b/, "communication"],
];
function knownTopicsInText(text: string) {
  return [...new Set(topicMatchers.filter(([pattern]) => pattern.test(text.toLowerCase())).map(([, topic]) => topic))];
}
function topicsForQuestion(question: Question) {
  const found = knownTopicsInText(question.text);
  if (found.length) return [...new Set(found)];

  const fallback = focusForQuestion(question).toLowerCase();
  if (["general", "recommend", "recommendation", "experience", "overall experience", "visit", "stood out", "stand out"].includes(fallback)
    || /\b(visit|experience|overall|stood out|stand out|favorite part|highlight)\b/.test(fallback)) return [];
  return [fallback];
}
function topicsForTextAnswer(question: Question, answer: string) {
  const explicitTopics = knownTopicsInText(answer);
  return explicitTopics.length ? explicitTopics : topicsForQuestion(question);
}
function topicsForBusiness(questions: Question[], primaryQuestionId: string) {
  return [...new Set(questions.filter((question) => question.id !== primaryQuestionId).flatMap(topicsForQuestion))];
}
function formatTopicList(topics: string[]) {
  const described = topics.map((topic) => {
    if (topic === "value for money") return "value for money";
    if (topic === "wait time") return "the wait";
    if (topic === "work quality") return "the quality of the work";
    return `the ${topic}`;
  });
  if (described.length < 2) return described[0] ?? "";
  if (described.length === 2) return `${described[0]} and ${described[1]}`;
  return `${described.slice(0, -1).join(", ")}, and ${described.at(-1)}`;
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
type RatingPhrases = { adjectives: string[]; impressions: string[]; feelings: string[]; takeaways: string[]; observations: string[]; experiences: string[]; reactions: string[] };
const ratingPhrases: Record<Tone, RatingPhrases> = {
  excellent: {
    adjectives: ["excellent", "incredible", "exceptionally enjoyable", "genuinely impressive", "remarkably satisfying", "very pleasant", "delightful", "better than I expected", "memorable", "refreshingly good", "thoroughly enjoyable", "worth remembering", "especially rewarding", "truly outstanding", "remarkably positive", "very satisfying", "wonderfully pleasant"],
    impressions: ["extremely positive", "stronger than I expected", "excellent overall", "very favorable", "distinctly positive", "impressive", "memorable for all the right reasons", "better than I had hoped", "exceptionally good", "one of the highlights", "really satisfying", "warm and positive"],
    feelings: ["very positive", "genuinely pleased", "thoroughly satisfied", "delighted", "impressed", "happy", "enthusiastic", "content", "glad to have visited", "great about my choice", "very satisfied with how it went", "pleasantly surprised"],
    takeaways: ["a very positive impression", "a strong sense of satisfaction", "a memorable overall impression", "a genuinely good feeling about my visit", "the sense that everything had gone exceptionally well", "a lot to appreciate", "a particularly favorable view", "a great memory of the experience", "a lasting positive impression", "nothing but good thoughts about my visit"],
    observations: ["stood out in the best way", "made a particularly good impression", "was a real highlight of my visit", "was among the strongest parts of the experience", "went beyond what I had expected", "left me feeling delighted", "was something I genuinely appreciated", "made the visit especially memorable", "was very well done", "earned my appreciation", "was a pleasure throughout", "was one of my favorite parts of the visit"],
    experiences: ["a wonderful experience", "an excellent visit", "a genuinely enjoyable time", "a thoroughly positive experience", "an especially pleasant experience", "a memorable visit", "a great overall experience", "a lovely time", "an experience that exceeded my expectations", "a very satisfying visit", "an impressive visit", "a refreshingly good experience", "a standout experience", "a really enjoyable visit", "an experience I appreciated", "a thoroughly enjoyable visit"],
    reactions: ["really impressed", "genuinely pleased", "thoroughly satisfied", "delighted", "happy", "pleasantly surprised", "glad", "in a very positive mood"],
  },
  positive: {
    adjectives: ["good", "really enjoyable", "quite pleasant", "satisfying", "better than I expected", "positive overall", "quite memorable", "pleasing", "nice", "impressive", "moderately enjoyable", "worthwhile", "comfortably above average", "very good", "better than average", "genuinely enjoyable"],
    impressions: ["quite positive", "generally favorable", "good overall", "better than I expected", "pleasant", "strong", "solid", "a little above average", "encouraging", "largely positive", "good from start to finish", "better than I had assumed"],
    feelings: ["positive", "pleased", "satisfied", "happy", "comfortable", "glad I visited", "pretty good", "appreciative", "content with how it went", "good about my choice", "more than satisfied", "in a good mood afterward"],
    takeaways: ["a good impression", "a pleasant memory", "a sense of satisfaction", "some positive thoughts about my visit", "the feeling that things had gone well", "a favorable view overall", "a nice impression to take away", "a good feeling about the experience", "plenty to appreciate", "a positive overall impression"],
    observations: ["left a good impression on me", "stood out for the right reasons", "was one of the better parts of my visit", "made the experience more enjoyable", "met my expectations", "was something I appreciated", "was handled well", "was a strong point of the visit", "was enjoyable overall", "made a positive difference", "was easy to feel good about", "left me satisfied"],
    experiences: ["a good experience", "a pleasant visit", "a really nice time", "a positive experience overall", "an enjoyable experience", "a satisfying experience", "a good time", "an enjoyable visit", "a nice experience", "a good visit overall", "a worthwhile experience", "a fairly memorable visit", "a welcome experience", "a solid visit overall", "a good experience from start to finish", "a generally pleasant visit"],
    reactions: ["pleased", "happy", "satisfied", "glad", "impressed", "in a positive mood", "content", "comfortable with how it went"],
  },
  average: {
    adjectives: ["fairly ordinary", "okay overall", "about what I expected", "neither especially good nor bad", "acceptable", "fine, though not memorable", "middle-of-the-road", "decent enough", "unremarkable", "average", "not bad, but not outstanding", "somewhat mixed", "reasonable", "ordinary", "fair", "just all right"],
    impressions: ["mixed", "fairly neutral", "somewhere in the middle", "about what I expected", "neither strongly positive nor negative", "acceptable overall", "not especially memorable", "ordinary", "moderate", "okay, but not outstanding", "hard to sum up as either great or bad", "pretty average"],
    feelings: ["mixed", "fairly neutral", "neither impressed nor disappointed", "okay about it", "somewhat undecided", "fine with how it went", "neither especially happy nor unhappy", "mostly indifferent", "on the fence", "moderately satisfied", "unsure what to make of it", "all right overall"],
    takeaways: ["mixed feelings", "a fairly neutral impression", "no particularly strong opinion", "the sense that it was fine overall", "a middle-of-the-road feeling", "an experience that was okay but not memorable", "some good and some ordinary moments", "an impression that was neither very good nor very bad", "a reasonable experience", "a generally average impression"],
    observations: ["was fine overall", "did not particularly stand out", "was about what I expected", "was neither a highlight nor a problem", "was okay without being memorable", "met the basic expectation", "felt ordinary to me", "was somewhere in the middle", "didn't leave a strong impression", "was acceptable overall", "was all right, though not remarkable", "could have been more memorable"],
    experiences: ["an average experience", "a fairly typical visit", "a mostly okay experience", "a middle-of-the-road visit", "an experience that was fine overall", "a visit that was not especially memorable", "a reasonable experience", "an ordinary visit", "a mixed experience", "an all-right visit", "an acceptable experience", "a visit that met basic expectations", "a fairly standard experience", "an experience that felt ordinary", "a decent experience", "an okay visit"],
    reactions: ["neither impressed nor disappointed", "fairly neutral about it", "a little undecided", "okay with how it went", "on the fence", "not especially moved either way", "moderately satisfied", "left with mixed feelings"],
  },
  negative: {
    adjectives: ["disappointing", "underwhelming", "less satisfying than I hoped", "not what I expected", "hard to enjoy", "below what I expected", "frustrating", "not very impressive", "in need of improvement", "less than satisfactory", "unpleasant", "not particularly enjoyable", "more difficult than it needed to be", "not up to the mark", "far from ideal", "worse than expected"],
    impressions: ["less favorable than I had hoped", "disappointing overall", "quite negative", "not very good", "below expectations", "underwhelming", "hard to recommend", "worse than I expected", "not especially positive", "frustrating", "a letdown", "in need of improvement"],
    feelings: ["disappointed", "let down", "frustrated", "underwhelmed", "unsatisfied", "unhappy with how it went", "less than impressed", "not very positive", "rather dissatisfied", "concerned", "discouraged", "regretful about the experience"],
    takeaways: ["a poor impression", "some disappointment", "the feeling that I had expected more", "a less favorable view", "mixed feelings, leaning negative", "a sense that things could have gone better", "an experience I found frustrating", "a disappointing overall impression", "more concerns than positives", "a visit that left me wanting more"],
    observations: ["fell short of what I hoped for", "didn't meet my expectations", "was disappointing", "could have been better", "was the weakest part of my visit", "left me wanting more", "didn't make a good impression", "was not very satisfying", "made the visit less enjoyable", "wasn't what I had hoped for", "needs room for improvement", "was more frustrating than it needed to be"],
    experiences: ["a disappointing experience", "a less satisfying visit", "a less-than-satisfying experience", "a frustrating visit", "an experience that could have gone better", "an underwhelming visit", "a difficult experience", "a visit that did not meet my expectations", "a disappointing experience overall", "an experience I found disappointing", "a visit that I hoped would go better", "a less enjoyable visit", "an unsatisfying experience", "a disappointing visit overall", "a frustrating experience overall", "a visit that could use improvement"],
    reactions: ["disappointed", "let down", "frustrated", "underwhelmed", "less than impressed", "unhappy", "unsatisfied", "rather dissatisfied"],
  },
};
function sentenceForRating(focus: string, value: string, used: Set<string>) {
  const phrases = ratingPhrases[toneForAnswer(value) ?? "average"];
  const subject = `the ${focus}`;
  const candidates = [
    ...phrases.adjectives.flatMap((phrase) => [`I found ${subject} ${phrase}.`, `For me, ${subject} was ${phrase}.`, `I would describe ${subject} as ${phrase}.`]),
  ];
  return chooseUnused(candidates, used);
}
function asContinuation(sentence: string) {
  const clause = sentence.trim().replace(/[.!?]+$/, "");
  return /^I\b/.test(clause) ? clause : `${clause[0]?.toLowerCase() ?? ""}${clause.slice(1)}`;
}
function overallLeadFor(name: string, value: string, used: Set<string>) {
  const phrases = ratingPhrases[toneForAnswer(value) ?? "average"];
  return chooseUnused([
    ...phrases.adjectives.map((phrase) => `My overall experience at ${name} was ${phrase}`),
    ...phrases.experiences.map((phrase) => `Overall, I had ${phrase} at ${name}`),
  ], used);
}
function openingFor(name: string, value: string, used: Set<string>, topics: string[] = []) {
  const phrases = ratingPhrases[toneForAnswer(value) ?? "average"];
  const topicList = formatTopicList(topics);
  const contextualCandidates = topicList ? [
      ...phrases.experiences.map((phrase) => `Considering ${topicList} together, I had ${phrase} at ${name}.`),
      ...phrases.adjectives.map((phrase) => `Taking ${topicList} into account, my overall experience at ${name} was ${phrase}.`),
      ...phrases.adjectives.map((phrase) => `My overall experience at ${name}, considering ${topicList}, was ${phrase}.`),
    ] : [];
  const generalCandidates = [
    ...phrases.experiences.map((phrase) => `I had ${phrase} at ${name}.`),
    ...phrases.adjectives.flatMap((phrase) => [
      `My visit to ${name} was ${phrase}.`,
      `I found my visit to ${name} ${phrase}.`,
      `I would describe my visit to ${name} as ${phrase}.`,
    ]),
    ...phrases.feelings.map((phrase) => `I left ${name} feeling ${phrase}.`),
    ...phrases.impressions.map((phrase) => `My overall impression of ${name} was ${phrase}.`),
    ...phrases.takeaways.map((phrase) => `${name} left me with ${phrase}.`),
    ...phrases.observations.map((phrase) => `The experience at ${name} ${phrase}.`),
    ...phrases.reactions.map((phrase) => `I was ${phrase} after my visit to ${name}.`),
  ];
  return chooseUnused(contextualCandidates.length ? contextualCandidates : generalCandidates, used);
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
    `My answer for ${focus} was ${normalized}.`, `For ${focus}, my answer was ${normalized}.`,
    `The option I selected for ${focus} was ${normalized}.`, `${normalized} is what I chose for ${focus}.`,
    `I selected ${normalized} in response to the question about ${focus}.`, `As for ${focus}, ${normalized} was my pick.`,
  ];
  return chooseUnused(pools, used);
}
function sentenceForText(value: string, used: Set<string>) {
  const text = value.replace(/[\r\n]+/g, " ").replace(/\s+/g, " ").trim();
  if (!text) return "";
  const normalized = text[0].toUpperCase() + text.slice(1);
  used.add(normalized);
  return /[.!?]$/.test(normalized) ? normalized : `${normalized}.`;
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
  const textAnswers = answers.filter((answer) => {
    const question = questions.find((item) => item.id === answer.questionId);
    return question?.answer_type === "text";
  });
  const textTopics = new Set(textAnswers.flatMap((answer) => {
    const question = questions.find((item) => item.id === answer.questionId);
    return question ? topicsForTextAnswer(question, answer.value) : [];
  }));
  const isCoveredByText = (question: Question) => topicsForQuestion(question).some((topic) => textTopics.has(topic));
  const otherAnswers = answers.filter((answer) => {
    if (answer === primary || answer.value.trim().toLowerCase() === "not applicable") return false;
    const question = questions.find((item) => item.id === answer.questionId);
    if (!question || question.answer_type === "text") return true;
    return !isCoveredByText(question);
  });
  if (primary && otherAnswers.length === 1) {
    const question = questions.find((item) => item.id === otherAnswers[0].questionId);
    if (question && question.answer_type !== "text") {
      const detail = sentenceForAnswer(question, otherAnswers[0].value, used);
      return `${overallLeadFor(name, primary.value, used)}, and ${asContinuation(detail)}.`.slice(0, 6000);
    }
  }

  const topics = primary
    ? otherAnswers.length === 0
      ? topicsForBusiness(questions, primary.questionId)
      : [...new Set(otherAnswers.flatMap((answer) => {
      const question = questions.find((item) => item.id === answer.questionId);
      return question && question.answer_type !== "text" ? topicsForQuestion(question) : [];
    }))]
    : [];
  const intro = primary
    ? openingFor(name, primary.value, used, topics)
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
    if (question.answer_type !== "text" && isCoveredByText(question)) continue;
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
