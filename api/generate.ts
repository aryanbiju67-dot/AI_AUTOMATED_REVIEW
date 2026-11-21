import { onRequestPost } from "../functions/api/generate";

export function POST(request: Request) {
  return onRequestPost({
    request,
    env: {
      SUPABASE_URL: process.env.SUPABASE_URL,
      SUPABASE_SECRET_KEY: process.env.SUPABASE_SECRET_KEY,
      TURNSTILE_SECRET_KEY: process.env.TURNSTILE_SECRET_KEY,
    },
  });
}
