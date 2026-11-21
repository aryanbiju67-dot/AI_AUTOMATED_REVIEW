import { useEffect, useRef, useState, type CSSProperties, type FormEvent } from "react";
import OwnerApp from "./OwnerApp";

type Language = "English" | "Hindi" | "Hinglish";
type Question = { id: string; text: string; required: boolean; answer_type: "rating" | "choice" | "text"; options: string[] };
type PublicPage = { business: { id: string; name: string; category: string; welcome_message: string; brand_color: string; google_review_url: string }; questions: Question[] };
type TurnstileWindow = Window & { turnstile?: { render: (target: HTMLElement, options: Record<string, unknown>) => string; reset: (widgetId?: string) => void; remove: (widgetId?: string) => void } };
const turnstileSiteKey = import.meta.env.VITE_TURNSTILE_SITE_KEY as string | undefined;
const languageChoices: Language[] = ["English", "Hindi", "Hinglish"];
const labels: Record<Language, { title: string; intro: string; required: string; optional: string; shortAnswer: string; submit: string; working: string; draftTitle: string; draftHint: string; editAnswers: string; copy: string; copyOpen: string; copied: string; copyError: string; stars: string; inactive: string; privacy: string }> = {
  English: { title: "How was your visit?", intro: "Share what stood out to you. Answer only what you like.", required: "Required", optional: "Optional", shortAnswer: "Write a brief answer…", submit: "Write my review", working: "Putting your thoughts into words…", draftTitle: "Your review draft", draftHint: "Edit this so it reflects your experience. Choose your stars yourself on Google.", editAnswers: "Edit my answers", copy: "Copy review", copyOpen: "Copy & open Google Maps", copied: "Copied. Paste your review on Google and choose your rating.", copyError: "Copy was blocked. Select the review text, copy it, then open Google.", stars: "On Google, choose your stars, paste your review, and post when ready.", inactive: "This QR code is not active", privacy: "Your answers and review draft are not stored." },
  Hindi: { title: "आपका अनुभव कैसा रहा?", intro: "अपने अनुभव के बारे में बताएं। जिन सवालों का जवाब देना चाहें, दें।", required: "ज़रूरी", optional: "ज़रूरी नहीं", shortAnswer: "संक्षेप में लिखें…", submit: "मेरी समीक्षा लिखें", working: "आपके विचार लिखे जा रहे हैं…", draftTitle: "आपकी समीक्षा का ड्राफ्ट", draftHint: "इसे अपने अनुभव के अनुसार बदलें। Google पर अपनी रेटिंग खुद चुनें।", editAnswers: "जवाब बदलें", copy: "समीक्षा कॉपी करें", copyOpen: "कॉपी करें और Google Maps खोलें", copied: "कॉपी हो गया। Google पर पेस्ट करें और अपनी रेटिंग चुनें।", copyError: "कॉपी नहीं हो पाया। समीक्षा चुनकर कॉपी करें, फिर Google खोलें।", stars: "Google पर स्टार चुनें, समीक्षा पेस्ट करें और तैयार होने पर पोस्ट करें।", inactive: "यह QR कोड चालू नहीं है", privacy: "आपके जवाब और समीक्षा का ड्राफ्ट सेव नहीं किया जाता।" },
  Hinglish: { title: "Aapka experience kaisa raha?", intro: "Apne visit ke baare mein batayein. Sirf un questions ka answer dein jo aap chahein.", required: "Required", optional: "Optional", shortAnswer: "Short answer likhein…", submit: "Meri review likhein", working: "Aapke thoughts likhe ja rahe hain…", draftTitle: "Aapka review draft", draftHint: "Isse apne experience ke hisaab se edit karein. Google par stars khud choose karein.", editAnswers: "Answers edit karein", copy: "Review copy karein", copyOpen: "Copy karke Google Maps kholein", copied: "Copied. Google par paste karke apni rating choose karein.", copyError: "Copy block ho gaya. Review select karke copy karein, phir Google kholein.", stars: "Google par stars choose karein, review paste karein, aur ready hone par post karein.", inactive: "Yeh QR code active nahi hai", privacy: "Aapke answers aur review draft save nahi hote." },
};

function getToken() {
  const match = window.location.pathname.match(/^\/r\/([^/]+)(?:\/draft)?\/?$/i);
  if (!match) return null;
  try { return decodeURIComponent(match[1]); } catch { return null; }
}

function CustomerReview({ token }: { token: string }) {
  const [page, setPage] = useState<PublicPage | null>(null);
  const [loading, setLoading] = useState(true);
  const [language, setLanguage] = useState<Language>("English");
  const [answers, setAnswers] = useState<Record<string, string>>({});
  const [draft, setDraft] = useState("");
  const [screen, setScreen] = useState<"questions" | "draft">("questions");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const [notice, setNotice] = useState("");
  const [turnstileToken, setTurnstileToken] = useState("");
  const turnstileHost = useRef<HTMLDivElement>(null);
  const widgetId = useRef<string | null>(null);
  const text = labels[language];
  const hasRequiredAnswers = Boolean(page?.questions.filter((question) => question.required).every((question) => answers[question.id]?.trim()));

  useEffect(() => {
    let cancelled = false;
    void fetch(`/api/shop?token=${encodeURIComponent(token)}`).then(async (response) => {
      const data = await response.json() as PublicPage & { error?: string };
      if (!response.ok) throw new Error(data.error || labels.English.inactive);
      return data;
    }).then((data) => {
      if (cancelled) return;
      if (!data.questions.length) throw new Error(labels.English.inactive);
      setPage(data);
      document.title = `${data.business.name} · Share your experience`;
      document.documentElement.lang = "en";
    }).catch((cause: unknown) => { if (!cancelled) setError(cause instanceof Error ? cause.message : labels.English.inactive); })
      .finally(() => { if (!cancelled) setLoading(false); });
    return () => { cancelled = true; };
  }, [token]);

  useEffect(() => {
    document.documentElement.lang = language === "Hindi" ? "hi" : language === "Hinglish" ? "hi-Latn" : "en";
  }, [language]);

  useEffect(() => {
    const basePath = `/r/${encodeURIComponent(token)}`;
    if (window.location.pathname.endsWith("/draft") && !draft) window.history.replaceState(null, "", basePath);
    const handlePopState = () => setScreen(window.location.pathname.endsWith("/draft") && Boolean(draft) ? "draft" : "questions");
    window.addEventListener("popstate", handlePopState);
    return () => window.removeEventListener("popstate", handlePopState);
  }, [token, draft]);

  useEffect(() => {
    if (!turnstileSiteKey || !turnstileHost.current || !page) return;
    let disposed = false;
    const mount = () => {
      const turnstile = (window as TurnstileWindow).turnstile;
      if (disposed || !turnstileHost.current || !turnstile || widgetId.current) return;
      widgetId.current = turnstile.render(turnstileHost.current, {
        sitekey: turnstileSiteKey, callback: (value: string) => setTurnstileToken(value), "expired-callback": () => setTurnstileToken(""), "error-callback": () => setTurnstileToken(""), theme: "light",
      });
    };
    const existing = document.querySelector<HTMLScriptElement>('script[data-turnstile="true"]');
    const script = existing ?? document.createElement("script");
    script.src = "https://challenges.cloudflare.com/turnstile/v0/api.js?render=explicit";
    script.async = true; script.defer = true; script.dataset.turnstile = "true";
    script.addEventListener("load", mount, { once: true });
    if (!existing) document.head.appendChild(script); else mount();
    return () => { disposed = true; if (widgetId.current) { (window as TurnstileWindow).turnstile?.remove(widgetId.current); widgetId.current = null; } };
  }, [page, screen]);

  useEffect(() => () => { if (widgetId.current) (window as TurnstileWindow).turnstile?.remove(widgetId.current); }, []);

  async function generateDraft() {
    if (!page || !hasRequiredAnswers || busy) return;
    setBusy(true); setError(""); setNotice("");
    try {
      const response = await fetch("/api/generate", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ token, language, answers: Object.entries(answers).filter(([, value]) => value.trim()).map(([questionId, value]) => ({ questionId, value: value.trim() })), turnstileToken }) });
      const data = await response.json() as { draft?: string; error?: string };
      if (!response.ok || !data.draft) throw new Error(data.error || "We couldn’t create a review draft. Please try again.");
      setDraft(data.draft);
      window.history.pushState({ reviewDraft: true }, "", `/r/${encodeURIComponent(token)}/draft`);
      setScreen("draft");
      setTurnstileToken("");
      window.scrollTo({ top: 0, behavior: "instant" });
    } catch (cause) { setError(cause instanceof Error ? cause.message : "We couldn’t create a review draft. Please try again."); }
    finally { setBusy(false); }
  }

  function submitAnswers(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    void generateDraft();
  }

  async function copyDraft() {
    if (!draft) return;
    try { await navigator.clipboard.writeText(draft); setNotice(text.copied); }
    catch { setNotice(text.copyError); }
  }

  if (loading) return <main className="page-shell"><section className="card inactive-card" role="status">Loading…</section></main>;
  if (!page) return <main className="page-shell inactive-page"><div className="brand-small"><span className="brand-dot" /> Review QR</div><section className="card inactive-card"><span className="icon-mark" aria-hidden="true">!</span><h1>{text.inactive}</h1><p>{error || "Please ask the business for an updated QR code."}</p></section><footer className="privacy-footer">{text.privacy}</footer></main>;

  return <main className="page-shell customer-page" style={{ "--shop-color": page.business.brand_color } as CSSProperties}>
    <header className="shop-header"><div className="brand-small"><span className="brand-dot" style={{ backgroundColor: page.business.brand_color }} />{page.business.name}</div><label className="language-picker"><span className="sr-only">Language</span><select aria-label="Language" value={language} onChange={(event) => setLanguage(event.target.value as Language)}>{languageChoices.map((item) => <option key={item}>{item}</option>)}</select></label></header>
    {screen === "questions" ? <section className="card customer-form-card"><div className="welcome-icon" aria-hidden="true"><svg viewBox="0 0 24 24"><path d="M5 5.5A2.5 2.5 0 0 1 7.5 3h9A2.5 2.5 0 0 1 19 5.5v8a2.5 2.5 0 0 1-2.5 2.5h-4l-4.5 4v-4h-.5A2.5 2.5 0 0 1 5 13.5z" /></svg></div>
      <p className="eyebrow">{page.business.category}</p><h1>{text.title}</h1><p className="intro-copy">{page.business.welcome_message || text.intro}</p>
      <form onSubmit={(event) => void submitAnswers(event)}>
        <div className="customer-question-list">{page.questions.map((question, index) => <fieldset className="customer-question" key={question.id}>
          <legend><span className="customer-question-number">{String(index + 1).padStart(2, "0")}</span>{question.text}<span className={question.required ? "customer-required" : "customer-optional"}>{question.required ? text.required : text.optional}</span></legend>
          {question.answer_type === "text" ? <textarea className="customer-answer-text" value={answers[question.id] ?? ""} onChange={(event) => setAnswers((current) => ({ ...current, [question.id]: event.target.value.slice(0, 160) }))} maxLength={160} rows={3} placeholder={text.shortAnswer} required={question.required} /> : <div className="customer-answer-options" role="radiogroup" aria-label={question.text}>
            {(question.answer_type === "rating" ? ["Good", "Average", "Bad"] : question.options).map((option) => <label className={`customer-answer-option ${answers[question.id] === option ? "is-selected" : ""}`} key={option}><input type="radio" name={`answer-${question.id}`} value={option} checked={answers[question.id] === option} onChange={() => setAnswers((current) => ({ ...current, [question.id]: option }))} /><span className="answer-radio" aria-hidden="true" />{option}</label>)}
          </div>}
        </fieldset>)}</div>
        {turnstileSiteKey && <div className="turnstile-wrap"><div ref={turnstileHost} /><p>Complete the quick security check to create your draft.</p></div>}
        {error && <p className="message message-error" role="alert">{error}</p>}
        <button className="button button-primary customer-submit" type="submit" disabled={busy || !hasRequiredAnswers || (Boolean(turnstileSiteKey) && !turnstileToken)}>{busy ? <><span className="spinner" aria-hidden="true" />{text.working}</> : <>{text.submit}<span aria-hidden="true">→</span></>}</button>
      </form>
      <p className="privacy-inline"><svg viewBox="0 0 20 20" aria-hidden="true"><path d="M10 2.5 4.2 5v4.2c0 4.1 2.5 6.7 5.8 8.3 3.3-1.6 5.8-4.2 5.8-8.3V5z"/><path d="m7.4 9.8 1.7 1.7 3.6-3.8"/></svg>{text.privacy}</p>
    </section> : <section className="card result-card" id="review-draft"><button className="back-button draft-back" type="button" onClick={() => window.history.back()}>{text.editAnswers}</button><div className="success-symbol" aria-hidden="true"><svg viewBox="0 0 24 24"><path d="m5 12.5 4.2 4.2L19 7" /></svg></div><p className="eyebrow">YOUR WORDS, SHAPED</p><h2>{text.draftTitle}</h2><p className="intro-copy">{text.draftHint}</p><label className="field-label" htmlFor="draft-text">{text.draftTitle}</label><textarea id="draft-text" className="draft-input" value={draft} onChange={(event) => setDraft(event.target.value)} maxLength={6000} rows={7} />{text.stars && <p className="honesty-hint">{text.stars}</p>}{notice && <p className="message message-success" role="status">{notice}</p>}<div className="result-actions"><button className="button button-secondary" type="button" onClick={() => void copyDraft()}>{text.copy}</button><a className="button button-primary google-link" href={page.business.google_review_url} target="_blank" rel="noopener noreferrer" onClick={() => void copyDraft()}>{text.copyOpen}<span aria-hidden="true">↗</span></a></div></section>}
    <footer className="privacy-footer">Only share what reflects your own experience. <span>·</span> <a href="/privacy.html">Privacy</a></footer>
  </main>;
}

export default function App() {
  const token = getToken();
  if (token) return <CustomerReview token={token} />;
  return <OwnerApp />;
}
