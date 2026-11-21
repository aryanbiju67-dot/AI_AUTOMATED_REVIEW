# Project instructions

- This is a React, TypeScript, and Vite app served by Cloudflare Pages and Pages Functions.
- The root page is the owner workspace. `/r/{token}` is the public customer flow.
- The allowlisted super-admin account manages multiple businesses from a sidebar. Each business has its own details, active QR token, and up to twenty questions. Questions support required/optional, ratings, custom choices, and short text answers.
- Validate owner inputs with Supabase RLS/RPC and validate customer answers again in the server function. Never trust client-side checks alone.
- Keep customer answers and generated review text out of app storage, analytics, logs, and error messages. The Google action must remain available and manual; do not choose stars or submit reviews.
- Turnstile, Supabase secret keys, and `SUPER_ADMIN_EMAIL` belong only in `.dev.vars` locally or Cloudflare Pages server settings. Only Supabase URL/publishable key and Turnstile site key may be client build variables.
- Preserve the existing typography and sage/green palette. Keep the owner interface compact, keyboard accessible, and usable on mobile.
- `npm run build` type-checks and builds the production frontend.
