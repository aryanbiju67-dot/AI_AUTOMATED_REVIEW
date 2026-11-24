import { lazy, Suspense, useEffect, useRef, useState, type CSSProperties, type FormEvent } from "react";

const OwnerApp = lazy(() => import("./OwnerApp"));

type Language = "English" | "Hindi" | "Hinglish";
type Question = { id: string; text: string; required: boolean; answer_type: "rating" | "choice" | "text"; options: string[] };
type PublicPage = { business: { id: string; name: string; category: string; welcome_message: string; brand_color: string; google_review_url: string }; questions: Question[] };
type TurnstileWindow = Window & { turnstile?: { render: (target: HTMLElement, options: Record<string, unknown>) => string; reset: (widgetId?: string) => void; remove: (widgetId?: string) => void } };
const turnstileSiteKey = import.meta.env.VITE_TURNSTILE_SITE_KEY as string | undefined;
const languageChoices: Language[] = ["English", "Hindi", "Hinglish"];
const labels: Record<Language, { title: string; intro: string; required: string; optional: string; shortAnswer: string; submit: string; working: string; draftTitle: string; draftHint: string; editAnswers: string; copyOpen: string; copied: string; copyError: string; popupBlocked: string; stars: string; inactive: string; privacy: string }> = {
  English: { title: "How was your visit?", intro: "Share what stood out to you. Answer only what you like.", required: "Required", optional: "Optional", shortAnswer: "Write a brief answer…", submit: "Generate, copy & open Google", working: "Drafting your review…", draftTitle: "Your review draft", draftHint: "Your draft was copied and Google opened. You can edit it here, then use the button below to copy your changes.", editAnswers: "Edit my answers", copyOpen: "Copy & open Google", copied: "Copied. Paste your review on Google and choose your rating.", copyError: "The draft is ready, but copying was blocked. Select the review text and copy it manually.", popupBlocked: "The draft is ready and copied, but your browser blocked Google Maps. Allow pop-ups and use the button below.", stars: "On Google, choose your stars, paste your review, and post when ready.", inactive: "This QR code is not active", privacy: "Your answers and review draft are not stored." },
  Hindi: { title: "आपका अनुभव कैसा रहा?", intro: "अपने अनुभव के बारे में बताएं। जिन सवालों का जवाब देना चाहें, दें।", required: "ज़रूरी", optional: "ज़रूरी नहीं", shortAnswer: "संक्षेप में लिखें…", submit: "समीक्षा बनाएं, कॉपी करें और Google खोलें", working: "आपकी समीक्षा तैयार हो रही है…", draftTitle: "आपकी समीक्षा का ड्राफ्ट", draftHint: "ड्राफ्ट कॉपी हो गया है और Google खुल गया है। आप यहां बदलाव करके नीचे दिए बटन से फिर कॉपी कर सकते हैं।", editAnswers: "जवाब बदलें", copyOpen: "कॉपी करें और Google खोलें", copied: "कॉपी हो गया। Google पर पेस्ट करें और अपनी रेटिंग चुनें।", copyError: "ड्राफ्ट तैयार है, लेकिन कॉपी नहीं हो पाया। समीक्षा चुनकर मैन्युअल रूप से कॉपी करें।", popupBlocked: "ड्राफ्ट कॉपी हो गया, लेकिन ब्राउज़र ने Google Maps को रोका। पॉप-अप की अनुमति देकर नीचे का बटन दबाएं।", stars: "Google पर स्टार चुनें, समीक्षा पेस्ट करें और तैयार होने पर पोस्ट करें।", inactive: "यह QR कोड चालू नहीं है", privacy: "आपके जवाब और समीक्षा का ड्राफ्ट सेव नहीं किया जाता।" },
  Hinglish: { title: "Aapka experience kaisa raha?", intro: "Apne visit ke baare mein batayein. Sirf un questions ka answer dein jo aap chahein.", required: "Required", optional: "Optional", shortAnswer: "Short answer likhein…", submit: "Generate, copy & open Google", working: "Aapki review draft ho rahi hai…", draftTitle: "Aapka review draft", draftHint: "Draft copy ho gaya aur Google khul gaya hai. Yahan edit karke neeche ke button se changes copy kar sakte hain.", editAnswers: "Answers edit karein", copyOpen: "Copy & open Google", copied: "Copied. Google par paste karke apni rating choose karein.", copyError: "Draft ready hai, par copy nahi hua. Review select karke manually copy karein.", popupBlocked: "Draft copy ho gaya, par browser ne Google Maps ko block kiya. Pop-ups allow karke neeche ka button use karein.", stars: "Google par stars choose karein, review paste karein, aur ready hone par post karein.", inactive: "Yeh QR code active nahi hai", privacy: "Aapke answers aur review draft save nahi hote." },
};

function getToken() {
  const match = window.location.pathname.match(/^\/r\/([^/]+)(?:\/draft)?\/?$/i);
  if (!match) return null;
  try { return decodeURIComponent(match[1]); } catch { return null; }
}

type PreparedClipboardWrite = { resolveDraft: (draft: string) => void; rejectDraft: () => void; finished: Promise<boolean> };
function prepareClipboardWrite(): PreparedClipboardWrite | null {
  if (!navigator.clipboard?.write || typeof ClipboardItem === "undefined") return null;
  let resolveContent!: (content: Blob) => void;
  let rejectContent!: (reason: Error) => void;
  const content = new Promise<Blob>((resolve, reject) => { resolveContent = resolve; rejectContent = reject; });
  try {
    const finished = navigator.clipboard.write([new ClipboardItem({ "text/plain": content })]).then(() => true, () => false);
    return {
      resolveDraft: (draft) => resolveContent(new Blob([draft], { type: "text/plain" })),
      rejectDraft: () => rejectContent(new Error("Review generation failed.")),
      finished,
    };
  } catch { rejectContent(new Error("Clipboard is unavailable.")); return null; }
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

  async function generateDraft(mapWindow: Window | null, clipboardWrite: PreparedClipboardWrite | null) {
    if (!page || !hasRequiredAnswers || busy) { clipboardWrite?.rejectDraft(); mapWindow?.close(); return; }
    setBusy(true); setError(""); setNotice("");
    try {
      const response = await fetch("/api/generate", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ token, language, answers: Object.entries(answers).filter(([, value]) => value.trim()).map(([questionId, value]) => ({ questionId, value: value.trim() })), turnstileToken }) });
      const data = await response.json() as { draft?: string; error?: string };
      if (!response.ok || !data.draft) throw new Error(data.error || "We couldn’t create a review draft. Please try again.");
      setDraft(data.draft);
      window.history.pushState({ reviewDraft: true }, "", `/r/${encodeURIComponent(token)}/draft`);
      setScreen("draft");
      setTurnstileToken("");
      let copied = false;
      if (clipboardWrite) {
        clipboardWrite.resolveDraft(data.draft);
        copied = await clipboardWrite.finished;
      }
      if (!copied) {
        try { await navigator.clipboard.writeText(data.draft); copied = true; } catch { /* The editable draft remains available if clipboard permission is denied. */ }
      }
      if (mapWindow) {
        mapWindow.opener = null;
        mapWindow.location.replace(page.business.google_review_url);
      }
      setNotice(!copied ? text.copyError : mapWindow ? text.copied : text.popupBlocked);
      window.scrollTo({ top: 0, behavior: "instant" });
    } catch (cause) { clipboardWrite?.rejectDraft(); mapWindow?.close(); setError(cause instanceof Error ? cause.message : "We couldn’t create a review draft. Please try again."); }
    finally { setBusy(false); }
  }

  function submitAnswers(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    const clipboardWrite = prepareClipboardWrite();
    const mapWindow = window.open("about:blank", "_blank");
    void generateDraft(mapWindow, clipboardWrite);
  }

  async function copyDraftAndOpenMaps() {
    if (!draft) return;
    const mapWindow = window.open("about:blank", "_blank");
    let copied = false;
    try { await navigator.clipboard.writeText(draft); copied = true; } catch { /* Show the manual-copy fallback. */ }
    if (mapWindow) { mapWindow.opener = null; mapWindow.location.replace(page?.business.google_review_url || "about:blank"); }
    setNotice(!copied ? text.copyError : mapWindow ? text.copied : text.popupBlocked);
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
            {(question.answer_type === "rating" ? ["Good", "Poor", "Average", "Excellent"] : question.options).map((option) => <label className={`customer-answer-option ${answers[question.id] === option ? "is-selected" : ""}`} key={option}><input type="radio" name={`answer-${question.id}`} value={option} checked={answers[question.id] === option} onChange={() => setAnswers((current) => ({ ...current, [question.id]: option }))} /><span className="answer-radio" aria-hidden="true" />{option}</label>)}
          </div>}
        </fieldset>)}</div>
        {turnstileSiteKey && <div className="turnstile-wrap"><div ref={turnstileHost} /><p>Complete the quick security check to create your draft.</p></div>}
        {error && <p className="message message-error" role="alert">{error}</p>}
        <button className="button button-primary customer-submit" type="submit" disabled={busy || !hasRequiredAnswers || (Boolean(turnstileSiteKey) && !turnstileToken)}>{busy ? <><span className="spinner" aria-hidden="true" />{text.working}</> : <><span className="draft-ai-icon" role="img" aria-label="Automated review draft">✦</span>{text.submit}<span aria-hidden="true">→</span></>}</button>
      </form>
      <p className="privacy-inline"><svg viewBox="0 0 20 20" aria-hidden="true"><path d="M10 2.5 4.2 5v4.2c0 4.1 2.5 6.7 5.8 8.3 3.3-1.6 5.8-4.2 5.8-8.3V5z"/><path d="m7.4 9.8 1.7 1.7 3.6-3.8"/></svg>{text.privacy}</p>
    </section> : <section className="card result-card" id="review-draft"><button className="back-button draft-back" type="button" onClick={() => window.history.back()}>{text.editAnswers}</button><div className="success-symbol" aria-hidden="true"><svg viewBox="0 0 24 24"><path d="m5 12.5 4.2 4.2L19 7" /></svg></div><p className="eyebrow">YOUR WORDS, SHAPED</p><h2>{text.draftTitle}</h2><p className="intro-copy">{text.draftHint}</p><label className="field-label" htmlFor="draft-text">{text.draftTitle}</label><textarea id="draft-text" className="draft-input" value={draft} onChange={(event) => setDraft(event.target.value)} maxLength={6000} rows={7} />{text.stars && <p className="honesty-hint">{text.stars}</p>}{notice && <p className="message message-success" role="status">{notice}</p>}<div className="result-actions"><button className="button button-primary google-link" type="button" onClick={() => void copyDraftAndOpenMaps()}>{text.copyOpen}<span aria-hidden="true">↗</span></button></div></section>}
    <footer className="privacy-footer">Only share what reflects your own experience. <span>·</span> <a href="/privacy.html">Privacy</a></footer>
  </main>;
}

export default function App() {
  const token = getToken();
  if (token) return <CustomerReview token={token} />;
  return <Suspense fallback={<main className="page-shell"><section className="card inactive-card" role="status">Loading dashboard…</section></main>}><OwnerApp /></Suspense>;
}
