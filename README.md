# Review QR

A business owner signs in, edits a simple customer questionnaire, and downloads a QR code. Customers scan it, answer the questions on one page, get an editable review draft, and choose whether to post it themselves on Google. The app never chooses stars or posts reviews for customers.

## Run the app locally

1. Use Node.js 22 LTS and run `npm install` in this folder.
2. Keep your existing public Supabase URL and publishable key in `.env.local` as `NEXT_PUBLIC_SUPABASE_URL` and `NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY`.
3. Keep `SUPABASE_URL` and `SUPABASE_SECRET_KEY` in `.dev.vars`. The secret key must never use a `VITE_` or `NEXT_PUBLIC_` prefix or appear in browser code.
4. In Supabase **SQL Editor**, run migrations `0001_mvp.sql` through `0005_business_autosave_and_delete.sql` in order. If 0001–0004 are already applied, run only 0005. Copy each file's contents into the editor; do not run the filename as SQL.
5. Run `npm run dev` and open the local URL printed by Wrangler, usually `http://localhost:8788`.
6. The app has no account-creation option and accepts only `htracker92@gmail.com`. If this Auth account does not exist, create or invite it from Supabase **Authentication → Users**, confirm the email, then sign in. A fresh app start clears the saved session and requires login again.

The root page is the super-admin workspace. Each downloaded QR points to `/r/{secure-token}` and loads its active business configuration from Supabase.

## Private keys

Turnstile, the Supabase secret key, and `SUPER_ADMIN_EMAIL` are server-side only. Use `.dev.vars` locally and Cloudflare Pages settings for deployment. Review drafts are composed locally; no AI key is needed. The publishable Supabase key and project URL are public client settings. All private files are ignored by Git.

## Deploy to Vercel

Import the repository into Vercel as a Vite project. Use build command `npm run build` and output directory `dist`. `api/` contains Vercel Functions for the existing Supabase endpoints, and `vercel.json` enables QR deep links.

To deploy this local folder without connecting GitHub, run `npx --yes vercel --global-config .vercel/cli-global login`, then run `npx --yes vercel --global-config .vercel/cli-global` from the project folder and follow the prompts to create or link a Vercel project. After configuring the environment variables below in the Vercel dashboard, deploy production with `npm run deploy`.

Configure these Vercel environment variables:

- Public build variables: `NEXT_PUBLIC_SUPABASE_URL`, `NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY`, and optional `VITE_TURNSTILE_SITE_KEY`.
- Server-only variables: `SUPABASE_URL`, `SUPABASE_SECRET_KEY`, `SUPER_ADMIN_EMAIL=htracker92@gmail.com`, and optional `TURNSTILE_SECRET_KEY`.

If you enable Turnstile, set both its site key and secret and allow your Vercel domain in the widget. Add the Vercel production domain to Supabase Authentication URL settings. Apply all SQL migrations to the same Supabase project before deploying, then sign in, create a business, and scan its QR from a phone.

For local development, `npm run dev` still runs the Cloudflare-compatible local server. `npm run dev:vercel` runs the Vercel CLI when it is installed and the project is linked.

See [BUILD_GUIDE.md](./BUILD_GUIDE.md) for the full setup steps.
