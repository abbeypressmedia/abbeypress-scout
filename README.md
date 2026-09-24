# Abbey Press Cloudflare

Cloudflare Pages/Functions version of the MailFlow Rotation SaaS.

## Current campaign flow

1. Connect multiple Gmail accounts once.
2. Import a prospect CSV.
3. Create a campaign and choose the exact Gmail accounts that should participate.
4. Set a per-sender campaign cap, daily sender caps, pacing, and message variation shuffle.
5. Click **Start sending**.
6. The server claims prospects safely, rotates selected senders round-robin, skips exhausted or reauthorization-required senders, remembers queue position, records history, and continues automatically.
7. Pause, resume, or stop a campaign from the dashboard.

Sending is server-side. The browser is not responsible for keeping a campaign alive.

## Architecture

- React + Vite frontend
- Cloudflare Pages static hosting
- Cloudflare Pages Functions under `functions/api`
- Supabase Auth/Postgres
- Gmail OAuth + Gmail REST API
- A separate Cloudflare Worker scheduler under `scheduler/`
- Postgres claim/finalize functions for campaign locking and idempotent state transitions

## Cloudflare Pages deployment

Build command: `npm run build`

Build output: `dist`

Functions directory: `functions`

Configure these variables/secrets in Cloudflare Pages:

- `VITE_SUPABASE_URL`
- `VITE_SUPABASE_ANON_KEY`
- `SUPABASE_URL`
- `SUPABASE_SERVICE_ROLE_KEY`
- `GOOGLE_CLIENT_ID`
- `GOOGLE_CLIENT_SECRET`
- `GOOGLE_REDIRECT_URI`
- `APP_URL`
- `CRON_SECRET`

The two VITE variables are browser configuration values. Do not mark them as secrets. Keep the Supabase service secret, Google client secret, and CRON_SECRET encrypted.

## Existing Supabase project

Do **not** recreate the Supabase project.

Run `supabase-campaign-engine-migration.sql` once in the existing Supabase SQL Editor. The migration only adds columns, indexes, and server-side functions; it does not delete the existing tables or sender data.

The migration adds:

- atomic campaign/prospect claiming
- sender leases for concurrency protection
- persistent claim tokens
- campaign progress counters
- message shuffle state
- daily sender counter reset
- safe finalization of send events

## Google OAuth

Set the Google OAuth redirect URI to:

`https://abbeypress-scout.pages.dev/api/gmail-callback`

The app uses the existing single Google OAuth Client ID/Secret. Each Gmail account authorizes that same app separately.

## Scheduler Worker

The Pages project does not run a background loop by itself. The repository includes a dedicated Cloudflare Worker in `scheduler/` with a one-minute Cron Trigger.

Create a second Cloudflare Worker from this repository using the `scheduler` directory as its root. Cloudflare Workers Builds can connect the same GitHub repository to a Worker and deploy it from its Wrangler configuration.

Set these scheduler variables/secrets:

- `APP_URL=https://abbeypress-scout.pages.dev`
- `CRON_SECRET=<same random secret configured on the Pages project>`

The scheduler sends an authenticated request to `/api/internal/cron-tick` every minute.

## Manual worker endpoint

`/api/send-worker` is still available for authenticated manual testing. It does not bypass the campaign engine or sender limits.

## Production hardening still required before public launch

- Encrypt Gmail refresh tokens at rest instead of storing them as plaintext.
- Add unsubscribe/suppression and bounce/complaint handling.
- Add a clear privacy policy and terms.
- Complete Google OAuth verification as required for the requested Gmail scope.
- Add more detailed audit logging and operational alerts.
- Keep provider limits and anti-abuse requirements intact. The engine intentionally does not implement quota bypassing or high-rate blasting.
