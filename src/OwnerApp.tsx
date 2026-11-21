import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import QRCode from "qrcode";
import { clearStoredSession, readPasswordRecoveryLink, readSession, requestPasswordReset, signIn, signOut, supabaseRest, supabaseRpc, updatePasswordFromRecovery } from "./lib/supabase-browser";
import "./owner.css";

type AnswerType = "rating" | "choice" | "text";
type Question = { id: string | null; text: string; enabled: boolean; required: boolean; answer_type: AnswerType; options: string[] };
type Business = { id: string; name: string; category: string; welcome_message: string; brand_color: string; google_review_url: string };
type QrRow = { token_value: string; label: string };
type Workspace = { business: Business; questions: Question[]; qrToken: string };
const QUESTION_LIMIT = 20;
const SUPER_ADMIN_EMAIL = "htracker92@gmail.com";
const categories = [["general", "General business"], ["restaurant", "Restaurant"], ["cafe", "Cafe"], ["salon", "Salon"], ["retail", "Retail"], ["clinic", "Clinic"], ["automotive", "Automotive"], ["other", "Other"]];
const defaultQuestions: Question[] = [
  { id: null, text: "How was your overall experience?", enabled: true, required: true, answer_type: "rating", options: ["Good", "Poor", "Average", "Excellent"] },
  { id: null, text: "What stood out during your visit?", enabled: true, required: false, answer_type: "text", options: [] },
];
function makeToken() {
  const bytes = crypto.getRandomValues(new Uint8Array(24));
  return btoa(String.fromCharCode(...bytes)).replaceAll("+", "-").replaceAll("/", "_").replace(/=+$/, "");
}
async function hashToken(token: string) {
  const digest = await crypto.subtle.digest("SHA-256", new TextEncoder().encode(token));
  return [...new Uint8Array(digest)].map((value) => value.toString(16).padStart(2, "0")).join("");
}
function blankBusiness(): Business { return { id: "", name: "", category: "general", welcome_message: "", brand_color: "#1f7a5c", google_review_url: "" }; }
function normalizeReviewUrl(value: string): string | null {
  try {
    const url = new URL(value.trim());
    if (url.protocol !== "https:") return null;
    return /(^|\.)google\.com$/.test(url.hostname) || url.hostname === "g.page" || url.hostname === "maps.app.goo.gl" ? url.toString() : null;
  } catch { return null; }
}

export default function OwnerApp() {
  const [session, setSession] = useState<ReturnType<typeof signIn> extends Promise<infer T> ? T | null : never>(null);
  const [recoveryLink] = useState(() => readPasswordRecoveryLink());
  const [recoveryMode, setRecoveryMode] = useState(Boolean(recoveryLink));
  const [recoveryToken, setRecoveryToken] = useState(recoveryLink?.accessToken || "");
  const [recoveryIssue, setRecoveryIssue] = useState(recoveryLink?.error || "");
  const [password, setPassword] = useState("");
  const [newPassword, setNewPassword] = useState("");
  const [confirmNewPassword, setConfirmNewPassword] = useState("");
  const [showPassword, setShowPassword] = useState(false);
  const [workspaces, setWorkspaces] = useState<Workspace[]>([]);
  const [selectedId, setSelectedId] = useState("");
  const selectedIdRef = useRef("");
  const [business, setBusiness] = useState<Business>(blankBusiness);
  const latestBusinessRef = useRef<Business>(blankBusiness());
  const [questions, setQuestions] = useState<Question[]>(defaultQuestions);
  const [qrToken, setQrToken] = useState("");
  const [qrImage, setQrImage] = useState("");
  const [loading, setLoading] = useState(false);
  const [busy, setBusy] = useState(false);
  const [notice, setNotice] = useState("");
  const [error, setError] = useState("");
  const [openBusinessMenu, setOpenBusinessMenu] = useState("");
  const creatingDraftRef = useRef(false);
  const activatingDraftsRef = useRef(new Set<string>());
  const reviewUrl = useMemo(() => qrToken ? `${window.location.origin}/r/${qrToken}` : "", [qrToken]);

  useEffect(() => {
    clearStoredSession();
    if (recoveryLink) window.history.replaceState(null, "", window.location.pathname);
  }, [recoveryLink]);

  const activateWorkspace = useCallback((workspace: Workspace | undefined) => {
    if (!workspace) {
      const blank = blankBusiness(); latestBusinessRef.current = blank;
      selectedIdRef.current = ""; setSelectedId(""); setBusiness(blank); setQuestions(defaultQuestions); setQrToken("");
      window.scrollTo({ top: 0, behavior: "smooth" });
      return;
    }
    selectedIdRef.current = workspace.business.id;
    latestBusinessRef.current = workspace.business;
    setSelectedId(workspace.business.id); setBusiness(workspace.business);
    setQuestions(workspace.questions.length ? workspace.questions : defaultQuestions); setQrToken(workspace.qrToken);
    window.scrollTo({ top: 0, behavior: "smooth" });
  }, []);

  const loadWorkspace = useCallback(async (preferredId?: string) => {
    const current = readSession();
    if (!current) { setSession(null); setLoading(false); return; }
    setSession(current); setLoading(true); setError("");
    try {
      const claimResponse = await fetch("/api/admin/claim", { method: "POST", headers: { Authorization: `Bearer ${current.access_token}` } });
      const claim = await claimResponse.json() as { error?: string };
      if (!claimResponse.ok) throw new Error(claim.error || "Could not verify admin access.");
      const memberships = await supabaseRest<Array<{ business_id: string }>>(`business_users?user_id=eq.${encodeURIComponent(current.user.id)}&role=eq.owner&select=business_id&order=created_at.asc`);
      const loaded = await Promise.all(memberships.map(async ({ business_id }) => {
        const id = encodeURIComponent(business_id);
        const [businessRows, questionRows, qrRows] = await Promise.all([
          supabaseRest<Business[]>(`businesses?id=eq.${id}&select=id,name,category,welcome_message,brand_color,google_review_url&limit=1`),
          supabaseRest<Question[]>(`questions?business_id=eq.${id}&select=id,text,enabled,required,answer_type,options&order=sort_order.asc`),
          supabaseRest<QrRow[]>(`qr_codes?business_id=eq.${id}&active=eq.true&select=token_value,label&limit=1`),
        ]);
        if (!businessRows[0]) return null;
        return { business: businessRows[0], questions: questionRows, qrToken: qrRows[0]?.token_value ?? "" } as Workspace;
      }));
      const nextWorkspaces = loaded.filter((workspace): workspace is Workspace => Boolean(workspace));
      setWorkspaces(nextWorkspaces);
      const next = nextWorkspaces.find((workspace) => workspace.business.id === (preferredId || selectedIdRef.current)) || nextWorkspaces[0];
      activateWorkspace(next);
    } catch (cause) { setError(cause instanceof Error ? cause.message : "Could not load your admin workspace."); }
    finally { setLoading(false); }
  }, [activateWorkspace]);

  useEffect(() => { if (session) void loadWorkspace(); else setLoading(false); }, [session?.access_token, loadWorkspace]);
  useEffect(() => {
    if (!reviewUrl) { setQrImage(""); return; }
    void QRCode.toDataURL(reviewUrl, { width: 320, margin: 2, errorCorrectionLevel: "H", color: { dark: "#142d29", light: "#ffffff" } }).then(setQrImage).catch(() => setError("The QR code could not be created."));
  }, [reviewUrl]);

  async function saveBusinessProfile(snapshot: Business, activeQrToken: string) {
    if (!snapshot.id || snapshot.name.trim().length < 2) return;
    const rawUrl = snapshot.google_review_url.trim();
    const reviewUrl = rawUrl ? normalizeReviewUrl(rawUrl) : null;
    if (rawUrl && !reviewUrl) return;
    await supabaseRpc("save_business_profile", {
      p_business_id: snapshot.id, p_name: snapshot.name.trim(), p_category: snapshot.category,
      p_welcome_message: snapshot.welcome_message.trim(), p_brand_color: snapshot.brand_color,
      p_google_review_url: reviewUrl,
    });
    if (!reviewUrl || activeQrToken || activatingDraftsRef.current.has(snapshot.id)) return;
    activatingDraftsRef.current.add(snapshot.id);
    const newToken = makeToken();
    try {
      await supabaseRpc("activate_business_draft", {
        p_business_id: snapshot.id, p_google_review_url: reviewUrl,
        p_token_hash: await hashToken(newToken), p_token_value: newToken,
      });
      setWorkspaces((current) => current.map((workspace) => workspace.business.id === snapshot.id
        ? { ...workspace, business: { ...workspace.business, ...snapshot, google_review_url: reviewUrl }, qrToken: newToken }
        : workspace));
      if (selectedIdRef.current === snapshot.id) setQrToken(newToken);
    } finally { activatingDraftsRef.current.delete(snapshot.id); }
  }

  useEffect(() => {
    if (!session || !business.id) return;
    const snapshot = { ...business };
    const tokenSnapshot = qrToken;
    const timer = window.setTimeout(() => {
      void saveBusinessProfile(snapshot, tokenSnapshot).catch((cause) => setError(cause instanceof Error ? cause.message : "Business details could not be saved."));
    }, 600);
    return () => window.clearTimeout(timer);
  }, [session?.access_token, business.id, business.name, business.category, business.welcome_message, business.brand_color, business.google_review_url, qrToken]);

  async function createBusinessDraft(snapshot: Business) {
    if (creatingDraftRef.current || !session) return;
    creatingDraftRef.current = true; setError("");
    try {
      const id = await supabaseRpc<string>("create_business_draft", { p_name: snapshot.name.trim() });
      const latest = { ...latestBusinessRef.current, id };
      latestBusinessRef.current = latest;
      const workspace = { business: latest, questions: defaultQuestions, qrToken: "" };
      setWorkspaces((current) => [workspace, ...current]);
      activateWorkspace(workspace);
    } catch (cause) { setError(cause instanceof Error ? cause.message : "Business could not be created."); }
    finally { creatingDraftRef.current = false; }
  }

  function updateBusiness(patch: Partial<Business>) {
    const next = { ...latestBusinessRef.current, ...patch };
    latestBusinessRef.current = next;
    setBusiness(next);
    if (next.id) setWorkspaces((current) => current.map((workspace) => workspace.business.id === next.id ? { ...workspace, business: next } : workspace));
    else if (next.name.trim().length >= 2) void createBusinessDraft(next);
  }

  async function authenticate(event: React.FormEvent<HTMLFormElement>) {
    event.preventDefault(); setBusy(true); setError(""); setNotice("");
    try {
      const next = await signIn(SUPER_ADMIN_EMAIL, password);
      const response = await fetch("/api/admin/claim", { method: "POST", headers: { Authorization: `Bearer ${next.access_token}` } });
      const result = await response.json() as { error?: string };
      if (!response.ok) { await signOut(); throw new Error(result.error || "This account is not allowed to access the admin workspace."); }
      setSession(next);
    } catch (cause) { setError(cause instanceof Error ? cause.message : "Could not sign in."); }
    finally { setBusy(false); }
  }

  async function requestPasswordRecovery() {
    setBusy(true); setError(""); setNotice("");
    try {
      await requestPasswordReset(SUPER_ADMIN_EMAIL);
      setNotice("If the admin account can receive recovery email, a reset link has been sent.");
    } catch (cause) { setError(cause instanceof Error ? cause.message : "Could not send a password reset link."); }
    finally { setBusy(false); }
  }

  async function saveRecoveredPassword(event: React.FormEvent<HTMLFormElement>) {
    event.preventDefault(); setBusy(true); setError(""); setNotice("");
    try {
      if (!recoveryToken) throw new Error("This recovery link is invalid or expired. Request a new one.");
      if (newPassword.length < 12) throw new Error("Choose a password with at least 12 characters.");
      if (newPassword !== confirmNewPassword) throw new Error("The passwords do not match.");
      await updatePasswordFromRecovery(recoveryToken, newPassword);
      clearStoredSession();
      setRecoveryToken(""); setRecoveryIssue(""); setRecoveryMode(false);
      setPassword(""); setNewPassword(""); setConfirmNewPassword("");
      setNotice("Password updated. Sign in with your new password.");
    } catch (cause) { setError(cause instanceof Error ? cause.message : "Could not update the password."); }
    finally { setBusy(false); }
  }

  async function saveSettings(event: React.FormEvent<HTMLFormElement>) {
    event.preventDefault(); setBusy(true); setError(""); setNotice("");
    try {
      if (!questions.some((question) => question.enabled)) throw new Error("Keep at least one question turned on.");
      if (questions.length > QUESTION_LIMIT) throw new Error(`You can add up to ${QUESTION_LIMIT} questions.`);
      const cleanQuestions = questions.map((question) => {
        const options = question.answer_type === "rating" ? ["Good", "Poor", "Average", "Excellent"] : question.answer_type === "choice" ? question.options.map((value) => value.trim()).filter(Boolean) : [];
        if (question.text.trim().length < 3) throw new Error("Each question needs at least 3 characters.");
        if (question.answer_type === "choice" && (options.length < 2 || options.length > 8)) throw new Error("Choice questions need 2 to 8 answer options.");
        return { id: question.id, text: question.text.trim(), enabled: question.enabled, required: question.required, answer_type: question.answer_type, options };
      });
      await supabaseRpc("save_business_settings", {
        p_business_id: business.id, p_name: business.name.trim(), p_category: business.category, p_welcome_message: business.welcome_message.trim(), p_brand_color: business.brand_color,
        p_google_review_url: new URL(business.google_review_url).toString(), p_logo_path: null, p_questions: cleanQuestions,
      });
      await loadWorkspace(business.id); setNotice("Saved. Your customer page now uses these questions.");
    } catch (cause) { setError(cause instanceof Error ? cause.message : "Could not save your changes."); }
    finally { setBusy(false); }
  }

  async function rotateQr() {
    setBusy(true); setError(""); setNotice("");
    try {
      const token = makeToken();
      await supabaseRpc("rotate_business_qr", { p_business_id: business.id, p_token_hash: await hashToken(token), p_token_value: token });
      setQrToken(token); setNotice("A new QR code is active. The previous QR link has been turned off.");
    } catch (cause) { setError(cause instanceof Error ? cause.message : "Could not renew the QR code."); }
    finally { setBusy(false); }
  }

  async function deleteBusiness(workspace: Workspace) {
    if (!window.confirm(`Delete ${workspace.business.name} and all its questions and QR codes? This cannot be undone.`)) return;
    setBusy(true); setError(""); setNotice("");
    try {
      await supabaseRpc("delete_business", { p_business_id: workspace.business.id });
      const remaining = workspaces.filter((item) => item.business.id !== workspace.business.id);
      setWorkspaces(remaining); setOpenBusinessMenu("");
      if (selectedIdRef.current === workspace.business.id) activateWorkspace(remaining[0]);
      setNotice(`${workspace.business.name} was deleted.`);
    } catch (cause) { setError(cause instanceof Error ? cause.message : "Business could not be deleted."); }
    finally { setBusy(false); }
  }

  async function logout() { await signOut(); setSession(null); setWorkspaces([]); activateWorkspace(undefined); }
  function startNewBusiness() {
    if (business.id) void saveBusinessProfile(business, qrToken).catch(() => setError("The previous business details could not be saved."));
    activateWorkspace(undefined); setError(""); setNotice(""); setOpenBusinessMenu("");
  }
  function selectBusiness(workspace: Workspace) {
    if (business.id && business.id !== workspace.business.id) void saveBusinessProfile(business, qrToken).catch(() => setError("The previous business details could not be saved."));
    activateWorkspace(workspace); setError(""); setNotice(""); setOpenBusinessMenu("");
  }
  function updateQuestion(index: number, patch: Partial<Question>) { setQuestions((current) => current.map((item, itemIndex) => itemIndex === index ? { ...item, ...patch } : item)); }
  function addQuestion() { setQuestions((current) => current.length >= QUESTION_LIMIT ? current : [...current, { id: null, text: "", enabled: true, required: false, answer_type: "rating", options: ["Good", "Poor", "Average", "Excellent"] }]); }
  function moveQuestion(index: number, direction: -1 | 1) {
    setQuestions((current) => { const nextIndex = index + direction; if (nextIndex < 0 || nextIndex >= current.length) return current; const next = [...current]; [next[index], next[nextIndex]] = [next[nextIndex], next[index]]; return next; });
  }

  if (loading) return <main className="owner-shell"><section className="owner-card owner-loading" aria-live="polite">Loading your admin workspace…</section></main>;
  if (recoveryMode) return <main className="owner-shell"><div className="owner-brand"><span className="brand-dot" /> Review QR</div><section className="owner-card auth-card-owner">
    <p className="owner-eyebrow">Super admin</p><h1>Choose a new password</h1><p className="owner-muted">Set a new password for your admin account.</p>
    {recoveryIssue ? <p className="owner-alert owner-alert-error" role="alert">{recoveryIssue}</p> : <form className="owner-form" onSubmit={saveRecoveredPassword}>
      <label>New password<input className="owner-input" type="password" value={newPassword} onChange={(event) => setNewPassword(event.target.value)} autoComplete="new-password" minLength={12} required /></label>
      <label>Confirm new password<input className="owner-input" type="password" value={confirmNewPassword} onChange={(event) => setConfirmNewPassword(event.target.value)} autoComplete="new-password" minLength={12} required /></label>
      {error && <p className="owner-alert owner-alert-error" role="alert">{error}</p>}{notice && <p className="owner-alert owner-alert-success" role="status">{notice}</p>}
      <button className="owner-button owner-button-primary" type="submit" disabled={busy || !recoveryToken}>{busy ? "Updating…" : "Update password"}</button>
      <button className="owner-button owner-button-secondary" type="button" onClick={() => void requestPasswordRecovery()} disabled={busy}>Send a new reset link</button>
    </form>}
    {recoveryIssue && <><button className="owner-button owner-button-primary" type="button" onClick={() => void requestPasswordRecovery()} disabled={busy}>{busy ? "Sending…" : "Send a new reset link"}</button>{notice && <p className="owner-alert owner-alert-success" role="status">{notice}</p>}{error && <p className="owner-alert owner-alert-error" role="alert">{error}</p>}</>}
  </section></main>;
  if (!session) return <main className="owner-shell"><div className="owner-brand"><span className="brand-dot" /> Review QR</div><section className="owner-card auth-card-owner">
    <p className="owner-eyebrow">Super admin</p><h1>Sign in</h1><p className="owner-muted">Use the authorized admin account to manage your businesses.</p>
    <form className="owner-form" onSubmit={authenticate}>
      <label>Admin email<input className="owner-input" type="email" value={SUPER_ADMIN_EMAIL} autoComplete="username" readOnly /></label>
      <label>Password<span className="password-row"><input className="owner-input" type={showPassword ? "text" : "password"} value={password} onChange={(event) => setPassword(event.target.value)} autoComplete="current-password" minLength={8} required /><button type="button" className="password-toggle" onClick={() => setShowPassword((value) => !value)}>{showPassword ? "Hide" : "Show"}</button></span></label>
      {error && <p className="owner-alert owner-alert-error" role="alert">{error}</p>}{notice && <p className="owner-alert owner-alert-success" role="status">{notice}</p>}
      <button className="owner-button owner-button-primary" type="submit" disabled={busy}>{busy ? "Verifying…" : "Sign in"}</button>
      <button className="owner-button owner-button-secondary" type="button" onClick={() => void requestPasswordRecovery()} disabled={busy}>{busy ? "Please wait…" : "Forgot password? Send reset link"}</button>
    </form>
  </section></main>;

  const hasBusiness = Boolean(business.id);
  return <main className="owner-shell owner-dashboard">
    <aside className="owner-sidebar"><div className="owner-brand"><span className="brand-dot" /> Review QR</div><div className="owner-sidebar-label">YOUR BUSINESSES</div><nav className="owner-business-list" aria-label="Businesses">
      {workspaces.map((workspace) => <div className={`owner-business-row ${selectedId === workspace.business.id ? "is-active" : ""}`} key={workspace.business.id}>
        <button type="button" className={`owner-business-link ${selectedId === workspace.business.id ? "is-active" : ""}`} onClick={() => selectBusiness(workspace)}><span className="owner-business-dot" />{workspace.business.name || "New business"}</button>
        <div className="owner-business-menu-wrap"><button type="button" className="owner-business-menu-trigger" aria-label={`Options for ${workspace.business.name}`} aria-expanded={openBusinessMenu === workspace.business.id} onClick={() => setOpenBusinessMenu((current) => current === workspace.business.id ? "" : workspace.business.id)}>⋯</button>
          {openBusinessMenu === workspace.business.id && <div className="owner-business-menu"><button type="button" disabled={busy} onClick={() => void deleteBusiness(workspace)}>Delete business</button></div>}
        </div>
      </div>)}
      <button type="button" className="owner-add-business" onClick={startNewBusiness}>＋ Add business</button>
    </nav><div className="owner-sidebar-account"><span>{session.user.email}</span><button className="owner-button owner-button-secondary" type="button" onClick={() => void logout()}>Sign out</button></div></aside>
    <div className="owner-main"><div className="owner-content"><div className="owner-heading"><div><p className="owner-eyebrow">{hasBusiness ? "BUSINESS SETTINGS" : "NEW BUSINESS"}</p><h1>{hasBusiness ? business.name : "Add a business"}</h1><p className="owner-muted">Manage business details, customer questions and QR codes.</p></div></div>
      {error && <p className="owner-alert owner-alert-error" role="alert">{error}</p>}{notice && <p className="owner-alert owner-alert-success" role="status">{notice}</p>}
      {!hasBusiness ? <section className="owner-card"><h2>Business details</h2><p className="owner-muted">These details appear on your customer page.</p>
        <form className="owner-form owner-business-form" onSubmit={(event) => event.preventDefault()}>
          <label>Business name<input className="owner-input" value={business.name} onChange={(event) => updateBusiness({ name: event.target.value })} minLength={2} maxLength={100} /></label>
          <label>Business type<select className="owner-input" value={business.category} onChange={(event) => updateBusiness({ category: event.target.value })}>{categories.map(([value, label]) => <option value={value} key={value}>{label}</option>)}</select></label>
          <label className="owner-span">Google Maps or review link<input className="owner-input" type="url" value={business.google_review_url} onChange={(event) => updateBusiness({ google_review_url: event.target.value })} placeholder="https://maps.google.com/..." /></label>
          <label className="owner-span">Welcome message <span className="owner-optional">Optional</span><textarea className="owner-input owner-textarea" value={business.welcome_message} onChange={(event) => updateBusiness({ welcome_message: event.target.value })} maxLength={180} /></label>
          <label>Accent colour<input className="owner-color" type="color" value={business.brand_color} onChange={(event) => updateBusiness({ brand_color: event.target.value })} /></label>
          <p className="owner-hint owner-span">Start typing a business name to add it to your dashboard. Details save automatically. Add its Google review link to create the QR code.</p>
        </form>
      </section> : <form className="owner-card owner-settings" onSubmit={saveSettings}>
        <section className="owner-section"><div className="owner-section-heading"><div><p className="owner-eyebrow">PUBLIC PAGE</p><h2>Business details</h2><p className="owner-muted">Business details save automatically.</p></div></div>
          <div className="owner-fields">
            <label>Business name<input className="owner-input" value={business.name} onChange={(event) => updateBusiness({ name: event.target.value })} minLength={2} maxLength={100} required /></label>
            <label>Business type<select className="owner-input" value={business.category} onChange={(event) => updateBusiness({ category: event.target.value })}>{categories.map(([value, label]) => <option value={value} key={value}>{label}</option>)}</select></label>
            <label className="owner-span">Google Maps or review link<input className="owner-input" type="url" value={business.google_review_url} onChange={(event) => updateBusiness({ google_review_url: event.target.value })} required /></label>
            <label className="owner-span">Welcome message <span className="owner-optional">Optional</span><textarea className="owner-input owner-textarea" value={business.welcome_message} onChange={(event) => updateBusiness({ welcome_message: event.target.value })} maxLength={180} /></label>
            <label>Accent colour<input className="owner-color" type="color" value={business.brand_color} onChange={(event) => updateBusiness({ brand_color: event.target.value })} /></label>
          </div>
        </section>
        <section className="owner-section"><div className="owner-section-heading owner-question-heading"><div><p className="owner-eyebrow">CUSTOMER FORM</p><h2>Questions</h2><p className="owner-muted">Shown together on one page, in the order below.</p></div><button className="owner-button owner-button-secondary" type="button" disabled={questions.length >= QUESTION_LIMIT} onClick={addQuestion}>Add question</button></div>
          <div className="owner-question-list">{questions.map((question, index) => <article className="owner-question" key={question.id ?? `new-${index}`}>
            <div className="owner-question-title"><span className="owner-order">{String(index + 1).padStart(2, "0")}</span><label className="owner-grow">Question text<input className="owner-input" value={question.text} onChange={(event) => updateQuestion(index, { text: event.target.value })} minLength={3} maxLength={100} required /></label><div className="owner-question-actions"><button className="owner-order-button" type="button" aria-label={`Move question ${index + 1} up`} disabled={index === 0} onClick={() => moveQuestion(index, -1)}>↑</button><button className="owner-order-button" type="button" aria-label={`Move question ${index + 1} down`} disabled={index === questions.length - 1} onClick={() => moveQuestion(index, 1)}>↓</button><button className="owner-remove" type="button" aria-label={`Remove question ${index + 1}`} onClick={() => setQuestions((current) => current.filter((_, itemIndex) => itemIndex !== index))}>Remove</button></div></div>
            <div className="owner-question-controls"><label>Answer type<select className="owner-input" value={question.answer_type} onChange={(event) => { const answer_type = event.target.value as AnswerType; updateQuestion(index, { answer_type, options: answer_type === "rating" ? ["Good", "Poor", "Average", "Excellent"] : answer_type === "choice" ? (question.options.length >= 2 ? question.options : ["Option 1", "Option 2"]) : [] }); }}><option value="rating">Rating</option><option value="choice">Choose from options</option><option value="text">Short written answer</option></select></label>
              {question.answer_type === "choice" && <label className="owner-grow">Options <span className="owner-optional">One per line, 2–8 choices</span><textarea className="owner-input owner-textarea owner-options" value={question.options.join("\n")} onChange={(event) => updateQuestion(index, { options: event.target.value.split("\n").slice(0, 8) })} rows={3} /></label>}
              {question.answer_type === "text" && <label className="owner-grow">Customer response<input className="owner-input" value="A brief sentence (up to 160 characters)" readOnly /></label>}
              <label className="owner-check"><input type="checkbox" checked={question.required} onChange={(event) => updateQuestion(index, { required: event.target.checked })} /> Required</label>
              <label className="owner-check"><input type="checkbox" checked={question.enabled} onChange={(event) => updateQuestion(index, { enabled: event.target.checked })} /> Show question</label>
            </div>
          </article>)}</div>
          <p className="owner-hint">Up to {QUESTION_LIMIT} questions. Customers can skip optional questions.</p>
        </section>
        <div className="owner-save-row"><span>Save question edits to update the customer page.</span><button className="owner-button owner-button-primary" type="submit" disabled={busy || !qrToken}>{busy ? "Saving…" : "Save questions"}</button></div>
      </form>}
      {hasBusiness && qrToken && <section className="owner-card owner-qr-card"><div><p className="owner-eyebrow">PRINT AND SHARE</p><h2>Business QR</h2><p className="owner-muted">Scan to preview the customer page.</p>{reviewUrl && <a className="owner-link" href={reviewUrl} target="_blank" rel="noreferrer">Open customer page ↗</a>}</div>
        <div className="owner-qr-preview">{qrImage && <img src={qrImage} alt={`QR code for ${business.name}`} width="220" height="220" />}{qrImage && <a className="owner-button owner-button-primary" href={qrImage} download={`${business.name.toLowerCase().replace(/[^a-z0-9]+/g, "-")}-review-qr.png`}>Download QR</a>}</div>
        <button className="owner-button owner-button-secondary" type="button" onClick={() => void rotateQr()} disabled={busy}>Create a new QR code</button><p className="owner-hint owner-span">Creating a new QR turns off the previous QR link.</p>
      </section>}
      {hasBusiness && !qrToken && <section className="owner-card"><h2>Finish business setup</h2><p className="owner-muted">Your business is saved. Add a valid Google Maps or review link above to activate it and create its QR code.</p></section>}
    </div></div>
  </main>;
}
