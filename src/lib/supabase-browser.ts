type Session = {
  access_token: string;
  refresh_token: string;
  expires_at: number;
  user: { id: string; email: string };
};

const storageKey = "review-qr.auth-session";
const env = import.meta.env as ImportMetaEnv & {
  NEXT_PUBLIC_SUPABASE_URL?: string;
  NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY?: string;
  VITE_SUPABASE_URL?: string;
  VITE_SUPABASE_PUBLISHABLE_KEY?: string;
};
const supabaseUrl = (env.NEXT_PUBLIC_SUPABASE_URL || env.VITE_SUPABASE_URL || "").replace(/\/$/, "");
const publishableKey = env.NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY || env.VITE_SUPABASE_PUBLISHABLE_KEY || "";

function configuration() {
  if (!supabaseUrl || !publishableKey) throw new Error("Add your Supabase project URL and publishable key to .env.local.");
  return { supabaseUrl, publishableKey };
}

export function readSession(): Session | null {
  try {
    const raw = localStorage.getItem(storageKey);
    return raw ? JSON.parse(raw) as Session : null;
  } catch { return null; }
}

function saveSession(session: Session | null) {
  if (session) localStorage.setItem(storageKey, JSON.stringify(session));
  else localStorage.removeItem(storageKey);
}

export function clearStoredSession() { saveSession(null); }

export type PasswordRecoveryLink = { accessToken: string | null; error: string | null };

export function readPasswordRecoveryLink(): PasswordRecoveryLink | null {
  const query = new URLSearchParams(window.location.search);
  const fragment = new URLSearchParams(window.location.hash.replace(/^#/, ""));
  const type = fragment.get("type") || query.get("type");
  const accessToken = fragment.get("access_token") || query.get("access_token");
  const error = fragment.get("error_description") || query.get("error_description") || fragment.get("error") || query.get("error");
  if (type !== "recovery" && !error) return null;

  return {
    accessToken,
    error: error || !accessToken ? "This recovery link is invalid or expired. Request a new one." : null,
  };
}

async function authRequest(path: string, body?: unknown, accessToken?: string) {
  const { supabaseUrl, publishableKey } = configuration();
  const response = await fetch(`${supabaseUrl}/auth/v1/${path}`, {
    method: body ? "POST" : "GET",
    headers: { apikey: publishableKey, "Content-Type": "application/json", ...(accessToken ? { Authorization: `Bearer ${accessToken}` } : {}) },
    ...(body ? { body: JSON.stringify(body) } : {}),
  });
  const data = await response.json().catch(() => ({})) as Record<string, unknown>;
  if (!response.ok) throw new Error(typeof data.msg === "string" ? data.msg : typeof data.message === "string" ? data.message : typeof data.error_description === "string" ? data.error_description : "Supabase could not complete that request.");
  return data;
}

function normalizeSession(data: Record<string, unknown>): Session | null {
  if (typeof data.access_token !== "string" || typeof data.refresh_token !== "string") return null;
  const user = data.user as { id?: string; email?: string } | undefined;
  if (!user?.id || !user.email) return null;
  const expiresIn = typeof data.expires_in === "number" ? data.expires_in : 3600;
  return { access_token: data.access_token, refresh_token: data.refresh_token, expires_at: Math.floor(Date.now() / 1000) + expiresIn, user: { id: user.id, email: user.email } };
}

export async function signIn(email: string, password: string) {
  const session = normalizeSession(await authRequest("token?grant_type=password", { email, password }));
  if (!session) throw new Error("Sign in did not return a session. Verify your email, then try again.");
  saveSession(session);
  return session;
}

export async function requestPasswordReset(email: string) {
  await authRequest("recover", { email });
}

export async function updatePasswordFromRecovery(accessToken: string, password: string) {
  const { supabaseUrl, publishableKey } = configuration();
  const response = await fetch(`${supabaseUrl}/auth/v1/user`, {
    method: "PUT",
    headers: { apikey: publishableKey, Authorization: `Bearer ${accessToken}`, "Content-Type": "application/json" },
    body: JSON.stringify({ password }),
    cache: "no-store",
  });
  const data = await response.json().catch(() => ({})) as Record<string, unknown>;
  if (!response.ok) throw new Error(typeof data.msg === "string" ? data.msg : typeof data.message === "string" ? data.message : typeof data.error_description === "string" ? data.error_description : "Supabase could not update the password.");
}

export async function signOut() {
  const session = readSession();
  if (session) await authRequest("logout", {}, session.access_token).catch(() => undefined);
  saveSession(null);
}

async function freshSession(): Promise<Session> {
  let session = readSession();
  if (!session) throw new Error("Please sign in to continue.");
  if (session.expires_at <= Math.floor(Date.now() / 1000) + 60) {
    const next = normalizeSession(await authRequest("token?grant_type=refresh_token", { refresh_token: session.refresh_token }));
    if (!next) { saveSession(null); throw new Error("Your session expired. Please sign in again."); }
    session = next;
    saveSession(session);
  }
  return session;
}

export async function supabaseRest<T>(path: string, options: RequestInit = {}): Promise<T> {
  const { supabaseUrl, publishableKey } = configuration();
  const session = await freshSession();
  const response = await fetch(`${supabaseUrl}/rest/v1/${path}`, {
    ...options,
    cache: "no-store",
    headers: { apikey: publishableKey, Authorization: `Bearer ${session.access_token}`, "Content-Type": "application/json", ...(options.headers ?? {}) },
  });
  const raw = await response.text();
  if (!response.ok) {
    let message = "Supabase could not save your changes.";
    try { const error = JSON.parse(raw) as { message?: string; details?: string }; message = error.message || error.details || message; } catch { /* Keep the friendly fallback. */ }
    throw new Error(message);
  }
  return (raw ? JSON.parse(raw) : null) as T;
}

export async function supabaseRpc<T>(name: string, values: Record<string, unknown>) {
  return supabaseRest<T>(`rpc/${name}`, { method: "POST", body: JSON.stringify(values) });
}
