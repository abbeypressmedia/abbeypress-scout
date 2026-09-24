# Abbey Press Scout

Cloudflare Pages + Pages Functions deployment for the MailFlow Rotation SaaS.

## Cloudflare Pages setup
Use **Git integration** with this GitHub repository and branch `main`.

- Root directory: `/`
- Build command: `npm run build`
- Build output directory: `dist`
- Do **not** use `wrangler deploy` as a custom deploy command. Cloudflare Pages Git integration handles the deployment.
- Functions live in `functions/api` and are detected by Pages.

## Environment variables
Add these in Cloudflare Pages > Settings > Environment variables for Production (and Preview when needed):

Browser configuration:
- `VITE_SUPABASE_URL`
- `VITE_SUPABASE_ANON_KEY`

Server secrets:
- `SUPABASE_URL`
- `SUPABASE_SERVICE_ROLE_KEY`
- `GOOGLE_CLIENT_ID`
- `GOOGLE_CLIENT_SECRET`
- `GOOGLE_REDIRECT_URI`
- `APP_URL`

The two `VITE_` values are intentionally public browser configuration. Never expose the service-role key or Google client secret in source control or browser code.

## Existing Supabase project
This app uses the existing Supabase project already configured for the application. Do not create a new Supabase project or rerun the database schema just for this deployment.

## Google OAuth
After Cloudflare gives the Pages production URL, set:
`GOOGLE_REDIRECT_URI=https://YOUR-PROJECT.pages.dev/api/gmail-callback`
`APP_URL=https://YOUR-PROJECT.pages.dev`

The exact redirect URI must also be registered in the existing Google OAuth client.

## Important
The sender queue must respect provider limits. Production sending also requires durable queue locking/idempotency, unsubscribe/suppression, bounce/complaint handling, audit logging, and OAuth/privacy/terms requirements before public launch.
