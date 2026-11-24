# Architecture

## Components

```text
Browser (React + Vite)
  ├─ owner sign-in and dashboard ── Supabase Auth + authenticated PostgREST/RPC
  └─ customer QR flow ── GET /api/shop ── Supabase public-page RPC
                      └─ POST /api/generate ── validate answers + compose draft

Vercel production:     api/ handlers
Cloudflare local/dev:  functions/api/ handlers
```

The two API directories implement the same HTTP behavior for the app's two supported runtimes. Keep them in sync when changing an endpoint: Vercel loads `api/`, while `npm run dev` runs Cloudflare Pages Functions from `functions/` through Wrangler.

## Owner flow

1. The browser signs in with Supabase Auth and asks `POST /api/admin/claim` to verify the session and account. No public account-registration interface exists.
2. The server verifies the confirmed email against the fixed super-admin allowlist and uses a server-only Supabase secret to claim the admin record.
3. Owner actions use authenticated Supabase RPCs and row-level security to create and manage businesses, questions, and QR tokens.
4. Each business QR contains a random token. The database stores its SHA-256 hash for public lookup and the raw token for the owner's QR link.

## Customer flow

1. `/r/{token}` loads the static Vite app. The app requests `/api/shop?token=...` for the public business details and enabled questions.
2. The customer submits answers and an optional Turnstile response to `POST /api/generate`.
3. The server resolves the QR token again, reloads the active questions, validates required answers and allowed choices, then composes the draft with the local phrase generator.
4. The browser presents the editable draft, copies it when permitted, and opens the configured Google review link. The customer chooses a rating and posts manually.

## Data and privacy boundaries

- Supabase stores owner accounts, business configuration, question definitions, and QR data.
- Submitted customer answers and generated review drafts are not written to app tables or sent to an AI provider. API responses use `Cache-Control: no-store`.
- Public business configuration is cached briefly by the shop endpoint. Do not cache generated drafts or answer submissions.
- Validate customer answers against database questions on the server; browser validation is only for usability.
- Supabase secret keys, the configured admin email, and Turnstile secrets stay server-side. Only the Supabase URL/publishable key and optional Turnstile site key are client build values.
- The Google action opens the business link only. The app must not select stars or submit a review for the customer.

## Deployment and configuration

Vercel production uses the root `api/` functions and `vercel.json`. The Cloudflare adapter under `functions/` supports the Wrangler local environment and optional Pages deployment. Shared UI and review behavior live in `src/` and both API adapters.

See [README.md](./README.md) for required variables and deployment instructions. See [BUILD_GUIDE.md](./BUILD_GUIDE.md) for initial Supabase setup.

## Current boundaries

The app does not offer billing, user invitations, automated review posting, review gating, or stored customer submissions. Review wording comes from a deterministic local phrase bank and can repeat; it is not generative AI. The application has no usage count cap, while infrastructure providers can still enforce their own quotas and abuse controls.

The initial Supabase migration includes legacy tables and RPCs from earlier iterations. They are retained in the migration history so existing installations can be upgraded consistently. Review the live database and back up any data before removing or changing schema through a new migration.
