# Campaign Scheduler Worker

This is the background scheduler for the MailFlow Pages application.

## Cloudflare Workers Build setup

Connect this GitHub repository to a separate Cloudflare Worker.

- Root directory: `scheduler`
- Production branch: `main`
- Build command: leave blank
- Deploy command: `npx wrangler deploy`

The repository already contains `scheduler/wrangler.jsonc`, including a one-minute Cron Trigger.

## Variables / secrets

Add:

- `APP_URL` — `https://abbeypress-scout.pages.dev`
- `CRON_SECRET` — a long random value

The same `CRON_SECRET` must be configured as an encrypted secret on the Pages project.

The Worker calls the Pages Function `/api/internal/cron-tick`. It never receives Gmail refresh tokens and never talks to Gmail directly.
