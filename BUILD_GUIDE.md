# First-time setup checklist

## 1. Configure Supabase

In your Supabase project, open **SQL Editor** and run migrations `0001_mvp.sql` through `0005_business_autosave_and_delete.sql` in order. If 0001–0004 are already applied, run only 0005. Open each SQL file in VS Code, copy its full contents into Supabase SQL Editor, and run the SQL (do not type the filename by itself).

In **Project Settings → API Keys**, use the publishable key in the browser and the secret key only on the server. Never use the secret key in a `NEXT_PUBLIC_` or `VITE_` variable.

In **Authentication → URL Configuration**, set your local URL while developing (for example `http://localhost:8788`) and add the deployed site URL when you deploy. Account creation may require email confirmation; confirm the account before setting up the business.

## 2. Set local environment values

The project already reads the public values from `.env.local`:

```env
NEXT_PUBLIC_SUPABASE_URL=https://your-project.supabase.co
NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY=your-publishable-key
VITE_TURNSTILE_SITE_KEY=your-turnstile-site-key
```

The local server values go in `.dev.vars`:

```env
SUPABASE_URL=https://your-project.supabase.co
SUPABASE_SECRET_KEY=your-supabase-secret-key
SUPER_ADMIN_EMAIL=htracker92@gmail.com
TURNSTILE_SECRET_KEY=your-turnstile-secret
```

Keep `.env.local` and `.dev.vars` out of Git. `.env.example` is a reference for public browser settings; it is not needed at runtime. Review drafts are local, so no Gemini key is required.

## 3. Start locally

In VS Code's terminal, run:

```bash
npm install
npm run dev
```

Open the local URL Wrangler prints, usually `http://localhost:8788`. The app requires login each time it starts and accepts only `htracker92@gmail.com`. If this Auth account does not exist yet, create or invite it from Supabase **Authentication → Users** and confirm it. The app itself has no account-creation option. Add businesses from the left sidebar; each has separate questions and QR settings.

## 4. Manage questions and QR

The admin workspace keeps all question controls on one page. Add up to twenty questions, move them with the up/down buttons, choose a rating, custom choices, or a short written response, and toggle required/visible. Save changes before testing the QR. Every business must keep at least one question visible. A QR rotation turns off the previous link.

## 5. Add Turnstile before a public pilot

Review drafts are composed locally from customer answers; no AI key or AI account is needed. The app enforces an 8-per-hour per-business/IP draft limit through Supabase. For a public pilot, create a Cloudflare Turnstile widget and allow your local hostname and deployed domain. Put its public site key in `.env.local` as `VITE_TURNSTILE_SITE_KEY` and the private secret in `.dev.vars` as `TURNSTILE_SECRET_KEY`. Do not expose the private secret in a browser variable.

## 6. Deploy to Vercel

Import the Git repository into Vercel, or deploy the current project folder with the Vercel CLI. From the project root, run `npx --yes vercel --global-config .vercel/cli-global login` and then `npx --yes vercel --global-config .vercel/cli-global` to create or link a project. Keep the project root as the repository root and use:

- Framework preset: Vite
- Build command: `npm run build`
- Output directory: `dist`
- Install command: `npm install`

Add these environment variables in **Vercel → Project Settings → Environment Variables**:

- Public build variables: `NEXT_PUBLIC_SUPABASE_URL`, `NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY`, and optional `VITE_TURNSTILE_SITE_KEY`.
- Server-only variables: `SUPABASE_URL`, `SUPABASE_SECRET_KEY`, `SUPER_ADMIN_EMAIL=htracker92@gmail.com`, and optional `TURNSTILE_SECRET_KEY`.

Use the same Supabase URL in both URL variables and put only the publishable key in the browser variable. Never set the Supabase secret key as `NEXT_PUBLIC_` or `VITE_`. If Turnstile is enabled, set both Turnstile values and allow the Vercel deployment hostname in the Turnstile widget. Add the production Vercel domain to Supabase **Authentication → URL Configuration**. Apply all migrations to the same Supabase project before deploying.

After saving environment variables, trigger a new deployment so the build and Functions receive them. Open the deployed site, sign in, add a business, and scan its QR from a phone. Vercel Functions are defined in the root `api/` directory; `vercel.json` routes customer QR paths back through the Vite app.

## 7. Before inviting customers

- Confirm the Google link opens the correct business on mobile.
- Test each question type, required and optional answers, and a fully negative/mixed experience.
- Confirm a draft is generated with Turnstile configured and with Turnstile absent. Review generation itself does not call an AI service.
- The app enforces its draft limit through Supabase. Turnstile helps reduce bot traffic but is not an hourly quota.
- Review the privacy wording for your use and location.
- Keep the owner account email secure. Anyone with an active QR link can submit answers to generate a draft, but answers and draft text are not saved by this app.
