# Review QR

Review QR lets an owner manage business profiles, customer questions, and QR codes from one dashboard. Customers scan a business QR code, answer its questions, and receive an editable review draft. They choose whether to copy it and open the business's Google review page; the app never selects a rating or posts a review.

Review text is composed by a local phrase-based generator. It does not use an AI provider. Customer answers and drafts are not saved by the app.

## Features

- One authorized super-admin account manages multiple businesses.
- Each business has its own profile, accent color, Google review link, questions, and QR code.
- Questions can be required or optional and use rating choices, owner-defined choices, or brief text.
- Review drafts can be edited, copied, and opened alongside the business's Google review page.
- Customer flows are available in English, Hindi, and Hinglish.
- The app does not impose a review-generation count limit. Hosting and database providers can still apply their own usage limits.

## Stack

- React 19, TypeScript, and Vite
- Supabase Auth and Postgres
- Vercel Functions for the deployed API; Cloudflare Pages Functions for the local development server

## Repository layout

| Path | Purpose |
| --- | --- |
| `src/` | Customer flow, owner dashboard, browser Supabase client, and styles |
| `api/` | Vercel serverless API handlers |
| `functions/` | Cloudflare Pages API handlers used by Wrangler locally |
| `supabase/migrations/` | Ordered database schema and policy changes |
| `public/` | Static privacy page and Cloudflare routing/header rules |
| `ARCHITECTURE.md` | Runtime, data flow, and privacy boundaries |
| `BUILD_GUIDE.md` | Supabase, local development, and deployment setup |

## Get started

### Requirements

- Node.js 22
- npm
- A Supabase project

### Install and configure

```sh
npm install
```

Copy `.env.example` to `.env.local` and enter the Supabase project URL and publishable key. These are browser-visible values; never put a Supabase secret key in this file.

Create `.dev.vars` for the local server functions:

```dotenv
SUPABASE_URL=https://your-project.supabase.co
SUPABASE_SECRET_KEY=your-supabase-secret-key
SUPER_ADMIN_EMAIL=htracker92@gmail.com
# Optional. Configure both Turnstile keys to enable the customer security check.
TURNSTILE_SECRET_KEY=
```

Do not commit `.env.local` or `.dev.vars`. Configure the same server-only values in your deployment provider's environment settings.

### Set up Supabase

Run the SQL files in `supabase/migrations/` in numerical order in the Supabase SQL Editor: `0001` through `0005`. For an existing database, run only migrations that have not already been applied. Do not rerun an applied migration.

The current application is restricted to the super-admin email configured in the server code and SQL migration `0004_lock_super_admin_to_htracker.sql`. A fork must replace that address in both server adapters (`api/admin/claim.ts` and `functions/api/admin/claim.ts`) and in its database migration strategy before use. Do not edit migrations that have already run in a live database; create a new migration for changes to that database.

In Supabase Authentication URL Configuration, set the local development URL and add the deployed site URL. Create or invite the authorized user from Supabase Authentication → Users, then confirm the account before signing in.

### Run locally

```sh
npm run dev
```

Open the local address printed by Wrangler, usually `http://localhost:8788`. The local command builds the Vite app and serves it with Cloudflare Pages Functions so the API routes work locally.

## Deploy

### Vercel

Import this repository into Vercel with the Vite framework preset, build command `npm run build`, and output directory `dist`. Add these environment variables in Vercel Project Settings:

| Variable | Scope | Value |
| --- | --- | --- |
| `NEXT_PUBLIC_SUPABASE_URL` | Build/client | Supabase project URL |
| `NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY` | Build/client | Supabase publishable key |
| `SUPABASE_URL` | Server | Supabase project URL |
| `SUPABASE_SECRET_KEY` | Server | Supabase secret key |
| `SUPER_ADMIN_EMAIL` | Server | `htracker92@gmail.com` |
| `VITE_TURNSTILE_SITE_KEY` | Build/client, optional | Turnstile site key |
| `TURNSTILE_SECRET_KEY` | Server, optional | Turnstile secret key |

If Turnstile is enabled, configure both keys and allow your deployed domain in the Turnstile widget. Add the deployed URL to Supabase Authentication URL Configuration. Vercel deploys the API handlers in `api/` and uses `vercel.json` for QR deep links and response headers.

### Cloudflare Pages

The alternate deployment adapter is in `functions/`. Build the app with `npm run build`, then deploy the `dist` directory with Wrangler. Configure `SUPABASE_URL`, `SUPABASE_SECRET_KEY`, and `SUPER_ADMIN_EMAIL` as server-side environment variables or secrets. Set optional Turnstile keys in the matching server and build environments.

## Project commands

| Command | Purpose |
| --- | --- |
| `npm run dev` | Local app with Cloudflare Pages Functions |
| `npm run dev:vercel` | Local Vercel development server (requires a linked Vercel project) |
| `npm run typecheck` | TypeScript check |
| `npm run build` | Type-check and create a production Vite build |
| `npm run preview` | Preview the built frontend |
| `npm run deploy` | Build and deploy to Vercel |
| `npm run deploy:cloudflare` | Build and deploy to Cloudflare Pages |

## Architecture and privacy

See [ARCHITECTURE.md](./ARCHITECTURE.md) for request flows, trust boundaries, and deployment layout. See [BUILD_GUIDE.md](./BUILD_GUIDE.md) for the detailed first-time setup checklist.

The customer endpoints reload business questions from Supabase and validate submitted answers on the server. The QR URL contains a random token; Supabase stores its hash for lookup. Customer answers are used only to produce the response and are not inserted into app tables, logged, or sent to an AI provider. The review text is a draft: customers should check it for accuracy and submit it themselves.

There is no application-level review count cap. This is not a promise of unlimited infrastructure: Vercel, Cloudflare, Supabase, or network usage limits may apply. Add provider-level abuse controls and monitor usage before a large public launch.
