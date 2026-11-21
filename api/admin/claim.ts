import { onRequestPost } from "../../functions/api/admin/claim";

export function POST(request: Request) {
  return onRequestPost({
    request,
    env: {
      SUPABASE_URL: process.env.SUPABASE_URL,
      SUPABASE_SECRET_KEY: process.env.SUPABASE_SECRET_KEY,
      SUPER_ADMIN_EMAIL: process.env.SUPER_ADMIN_EMAIL,
    },
  });
}
