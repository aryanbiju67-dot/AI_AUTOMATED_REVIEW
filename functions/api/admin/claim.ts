interface Env { SUPABASE_URL?: string; SUPABASE_SECRET_KEY?: string; SUPER_ADMIN_EMAIL?: string }
interface PagesContext { request: Request; env: Env }
const REQUIRED_SUPER_ADMIN_EMAIL = "htracker92@gmail.com";

function json(body: unknown, status = 200) {
  return Response.json(body, { status, headers: { "Cache-Control": "no-store", "X-Content-Type-Options": "nosniff" } });
}

function serverHeaders(secretKey: string) {
  return {
    apikey: secretKey,
    ...(secretKey.startsWith("sb_secret_") ? {} : { Authorization: `Bearer ${secretKey}` }),
    "Content-Type": "application/json",
  };
}

export async function onRequestPost({ request, env }: PagesContext) {
  const origin = request.headers.get("Origin");
  if (origin && new URL(origin).host !== new URL(request.url).host) return json({ error: "Request not allowed." }, 403);
  if (!env.SUPABASE_URL || !env.SUPABASE_SECRET_KEY || env.SUPER_ADMIN_EMAIL?.trim().toLowerCase() !== REQUIRED_SUPER_ADMIN_EMAIL) return json({ error: "The server admin email is not configured correctly." }, 503);
  const authorization = request.headers.get("Authorization") || "";
  if (!authorization.startsWith("Bearer ") || authorization.length > 5000) return json({ error: "Please sign in again." }, 401);
  const baseUrl = env.SUPABASE_URL.replace(/\/$/, "");
  try {
    const userResponse = await fetch(`${baseUrl}/auth/v1/user`, {
      headers: { apikey: env.SUPABASE_SECRET_KEY, Authorization: authorization },
      signal: AbortSignal.timeout(3500),
    });
    if (!userResponse.ok) return json({ error: "Your sign-in session is no longer valid. Please sign in again." }, 401);
    const user = await userResponse.json() as { id?: string; email?: string; email_confirmed_at?: string | null };
    if (!user.id || !user.email || !user.email_confirmed_at) return json({ error: "Confirm your email before opening the admin workspace." }, 403);
    if (user.email.trim().toLowerCase() !== REQUIRED_SUPER_ADMIN_EMAIL) return json({ error: "This account is not authorized to sign in as super admin." }, 403);

    const claimResponse = await fetch(`${baseUrl}/rest/v1/rpc/claim_first_platform_admin`, {
      method: "POST", headers: serverHeaders(env.SUPABASE_SECRET_KEY),
      body: JSON.stringify({ p_user_id: user.id, p_email: user.email }), signal: AbortSignal.timeout(3500),
    });
    if (!claimResponse.ok) return json({ error: "Could not confirm admin access. Check the database migration, then try again." }, 503);
    const claimed = await claimResponse.json();
    if (claimed !== true) return json({ error: "The authorized super admin account could not be registered." }, 403);
    return json({ admin: true });
  } catch {
    return json({ error: "Could not verify admin access. Please try again." }, 503);
  }
}
