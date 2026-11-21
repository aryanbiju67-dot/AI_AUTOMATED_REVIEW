interface Env {
  SUPABASE_URL?: string;
  SUPABASE_SECRET_KEY?: string;
}
interface PagesContext { request: Request; env: Env }

function json(body: unknown, status = 200) {
  return Response.json(body, { status, headers: { "Cache-Control": "no-store", "X-Content-Type-Options": "nosniff" } });
}

async function sha256(value: string) {
  const digest = await crypto.subtle.digest("SHA-256", new TextEncoder().encode(value));
  return [...new Uint8Array(digest)].map((byte) => byte.toString(16).padStart(2, "0")).join("");
}

function serverHeaders(secretKey: string) {
  return {
    apikey: secretKey,
    // Supabase's new sb_secret keys are not JWTs and belong only in apikey. Older service_role JWT keys also set the PostgREST role through Authorization.
    ...(secretKey.startsWith("sb_secret_") ? {} : { Authorization: `Bearer ${secretKey}` }),
    "Content-Type": "application/json",
  };
}

export async function onRequestGet({ request, env }: PagesContext) {
  const token = new URL(request.url).searchParams.get("token") || "";
  if (!/^[A-Za-z0-9_-]{28,40}$/.test(token)) return json({ error: "This QR code is not active." }, 404);
  if (!env.SUPABASE_URL || !env.SUPABASE_SECRET_KEY) return json({ error: "The business workspace is not connected yet." }, 503);
  try {
    const response = await fetch(`${env.SUPABASE_URL.replace(/\/$/, "")}/rest/v1/rpc/get_public_review_page`, {
      method: "POST",
      headers: serverHeaders(env.SUPABASE_SECRET_KEY),
      body: JSON.stringify({ p_token_hash: await sha256(token) }),
      signal: AbortSignal.timeout(3500),
    });
    if (!response.ok) return json({ error: "The business page could not be loaded." }, 503);
    const data = await response.json() as { business?: { id: string; name: string; category: string; welcome_message: string; brand_color: string; google_review_url: string }; questions?: Array<{ id: string; text: string; required: boolean; answer_type: "rating" | "choice" | "text"; options: string[] }> } | null;
    if (!data?.business || !Array.isArray(data.questions) || !data.questions.length) return json({ error: "This QR code is not active." }, 404);
    return json({ business: data.business, questions: data.questions });
  } catch {
    return json({ error: "The business page could not be loaded. Please try again." }, 503);
  }
}
