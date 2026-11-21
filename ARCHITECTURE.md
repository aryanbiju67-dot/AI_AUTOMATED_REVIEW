# Review QR architecture

## Runtime

- React, TypeScript, and Vite build the owner workspace and public customer form.
- Cloudflare Pages serves the app and the `/api/*` Pages Functions.
- Supabase Auth and Postgres hold owner accounts, business settings, question definitions, and active QR tokens. Row-level security protects owner data.
- Public QR tokens are random values. Only their SHA-256 hashes are used to resolve a business page on the server.
- Review drafts are composed locally in a server function from validated answers. Phrase banks vary the wording for common topics in English, Hindi, and Hinglish; customer-written details are included verbatim. No AI provider or per-business prompt is required.

## Owner flow

1. The configured super-admin email signs in through Supabase Auth. A server function verifies the account and claims the initial admin record once.
2. The super admin creates multiple businesses from the left sidebar. Each business has its own questions and QR code.
3. The admin can edit business details and up to twenty questions in one vertically stacked editor. Each question can be required or optional and can use a rating, owner-defined choices, or a brief written response.
4. The admin downloads a QR image for the selected business. Rotating the QR disables the previous token.

## Customer flow and privacy

1. `/r/{token}` requests the active public page from a server function.
2. Customers answer the active questions on one page. The browser sends only those answers and the QR token to `/api/generate`.
3. The server reloads the questions from Supabase and validates the required fields and allowed answer values. It does not trust client-side validation.
4. Answers and generated review text are not inserted into the app database or sent to an AI provider. The server uses answers only to compose the response for that request.
5. Customers may edit and copy the draft or copy it while opening the business's Google Maps link. They choose their own stars and submit manually.

## Secrets

- Browser: Supabase project URL and publishable key only.
- Server: Supabase secret key and optional Turnstile secret in `.dev.vars` locally or Cloudflare Pages secrets in production.
- Never put server secrets in `VITE_` or `NEXT_PUBLIC_` variables.

## Current MVP boundaries

There is no payment flow, branch management, automated posting, review gating, saved customer answers, or saved review drafts. Set up Cloudflare rate limiting on `/api/generate` before a public pilot. Turnstile reduces automated abuse but does not enforce a strict hourly usage quota.
