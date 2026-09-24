# Abbey Press Cloudflare

Cloudflare Pages/Functions version of the MailFlow Rotation SaaS.

## Architecture
- React + Vite frontend
- Cloudflare Pages static hosting
- Cloudflare Pages Functions under `functions/api`
- Supabase Auth/Postgres
- Gmail OAuth + Gmail REST API
- Persistent sender rotation and campaign state

## Cloudflare deployment
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

The two VITE variables are browser configuration values. Do not mark them as secrets. Keep the service role key and Google client secret encrypted.

## Google OAuth
Set the Google OAuth redirect URI to:
`https://YOUR-CLOUDFLARE-DOMAIN/api/gmail-callback`

## Worker
`/api/send-worker` performs one queue tick. A scheduler should invoke it with an authenticated service-to-service mechanism in production. Do not expose an unauthenticated worker endpoint.

## Production hardening
- Encrypt refresh tokens at rest.
- Use a durable queue/lock/idempotency strategy so concurrent workers cannot send the same prospect twice.
- Add unsubscribe/suppression and bounce/complaint handling.
- Add audit logging.
- Add OAuth verification, privacy policy and terms before public launch.
- Keep provider limits and anti-abuse requirements intact.
