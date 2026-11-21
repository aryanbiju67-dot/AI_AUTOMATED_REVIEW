import { onRequestGet } from "../functions/api/shop";

export function GET(request: Request) {
  return onRequestGet({
    request,
    env: { SUPABASE_URL: process.env.SUPABASE_URL, SUPABASE_SECRET_KEY: process.env.SUPABASE_SECRET_KEY },
  });
}
