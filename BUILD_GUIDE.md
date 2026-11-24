# Setup guide

This checklist is for a fresh local setup. For an existing Supabase project, do not rerun migrations that have already been applied.

## 1. Supabase

1. Create a Supabase project and open **Project Settings → API Keys**.
2. Copy the project URL and publishable key for the browser. Keep the Supabase secret key for server-side use only.
3. In **Authentication → Users**, create or invite the authorized super-admin user and confirm its email.
4. In **SQL Editor**, run `supabase/migrations/0001_mvp.sql` through `0005_business_autosave_and_delete.sql` in order. Record which migrations you have applied.
5. In **Authentication → URL Configuration**, add your local URL and deployed production URL to the site's allowed redirect URLs.

This repository's current allowlist is specific to its original admin account. See the README before deploying a fork with a different administrator.

## 2. Local environment

Copy `.env.example` to `.env.local`, then enter the public browser values:

```dotenv
NEXT_PUBLIC_SUPABASE_URL=https://your-project.supabase.co
NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY=your-publishable-key
VITE_TURNSTILE_SITE_KEY=
```

Create `.dev.vars` in the repository root for the local server:

```dotenv
SUPABASE_URL=https://your-project.supabase.co
SUPABASE_SECRET_KEY=your-supabase-secret-key
SUPER_ADMIN_EMAIL=htracker92@gmail.com
TURNSTILE_SECRET_KEY=
```

`.env.local` and `.dev.vars` are ignored by Git. Never put a Supabase secret or Turnstile secret in a `NEXT_PUBLIC_` or `VITE_` variable.

## 3. Start the app

```sh
npm install
npm run dev
```

Open the URL printed by Wrangler (usually `http://localhost:8788`). Sign in with the confirmed allowlisted account, create a business, configure its Google review URL and questions, then scan the generated QR.

## 4. Vercel production

Import the Git repository in Vercel. Use the Vite framework preset, `npm run build` as the build command, and `dist` as the output directory. Add the same values in Vercel Project Settings → Environment Variables:

- Build/client: `NEXT_PUBLIC_SUPABASE_URL`, `NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY`
- Server: `SUPABASE_URL`, `SUPABASE_SECRET_KEY`, `SUPER_ADMIN_EMAIL`
- Optional Turnstile: `VITE_TURNSTILE_SITE_KEY` (build/client) and `TURNSTILE_SECRET_KEY` (server)

The two Supabase URL variables must refer to the same project. Turnstile is optional; when enabled, configure both keys and allow the deployed hostname in the widget. Redeploy after changing environment variables.

Add the production domain to Supabase Authentication URL Configuration. Then sign in, create a test business, scan the QR on a phone, submit sample answers, and confirm the customer must paste and post the review manually.

## 5. Cloudflare Pages (optional)

The `functions/` adapter can also serve the API on Cloudflare Pages. Build with `npm run build`, deploy `dist`, and configure `SUPABASE_URL`, `SUPABASE_SECRET_KEY`, and `SUPER_ADMIN_EMAIL` as server-side settings. Optional Turnstile values are configured as for Vercel.

## Security and operations

- The review generator uses a local phrase bank; no Gemini or other AI key is required.
- The app does not enforce a review-generation count cap. Provider quotas and abuse controls still apply; monitor usage and configure provider-level protections for a public launch.
- Customer answers and drafts are not stored by this app. Avoid adding analytics, logs, or error reporting that captures review text.
- Keep database backups and apply schema changes as new numbered migrations. Never rewrite a migration that has already run on a live project.
