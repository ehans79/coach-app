# Coach App

Personal training app for Edu: syncs runs from Strava, posts a coach's
comment on each activity, regenerates the running plan every Sunday evening
based on recent training trends, and emails a weekly debrief. Single user,
no auth, light theme only. See `coach-app-brief.md` for the full spec.

## Stack

Next.js 16 (App Router) · TypeScript · Postgres via Drizzle ORM · Tailwind ·
Anthropic API (Claude) for plan regeneration + activity commentary ·
Resend + React Email for the weekly debrief · Open-Meteo for historical
weather · deployed on Railway.

## Local setup

1. `npm install`
2. Copy `.env.example` to `.env.local` and fill in the values (see below for
   where each one comes from).
3. Point `DATABASE_URL` at a reachable Postgres instance, then:
   ```bash
   npm run db:push     # apply the schema (dev convenience — see below)
   npm run db:seed     # seed athlete profile, zones, and plan v1 from return-to-running-2026-10-11.json
   ```
4. Connect Strava once: start `npm run dev`, then visit
   `http://localhost:3000/connect/strava?token=<INTERNAL_API_TOKEN>` and
   approve. This exchanges an authorization code for a refresh token, stored
   in Postgres — after this the app refreshes its own access token
   automatically and no further manual login is needed.
5. Backfill training history (optional but recommended — gives the
   regeneration engine visibility into pre-launch training, e.g. the Aug
   2025 shin issue / recovery block):
   ```bash
   npm run strava:backfill -- 2025-06-01
   ```

### Getting the env var values

- `STRAVA_CLIENT_ID` / `STRAVA_CLIENT_SECRET` — create an API app at
  https://www.strava.com/settings/api. Authorization Callback Domain should
  be the host of `APP_BASE_URL` (e.g. `localhost` for local dev, or the
  Railway domain in production).
- `STRAVA_VERIFY_TOKEN` — any random string you choose; used to verify the
  webhook handshake.
- `INTERNAL_API_TOKEN` — any long random string; gates `/connect/strava` and
  the internal `/api/internal/*` endpoints that would otherwise be public.
- `ANTHROPIC_API_KEY` — from console.anthropic.com.
- `RESEND_API_KEY` / `NOTIFY_EMAIL` — from resend.com, and Edu's own address.
- `APP_BASE_URL` — no trailing slash; used to build the Strava OAuth
  redirect URI and dashboard links.

### Database migrations

`npm run db:push` (drizzle-kit push) is fine for local dev iteration. For
anything durable, generate a migration and check it in:

```bash
npm run db:generate   # writes drizzle/NNNN_*.sql from schema.ts
npm run db:migrate     # applies pending migrations
```

## Railway deployment

This folder is the Railway service **Root Directory** in a monorepo — don't
assume the repo root is the project root anywhere in configs or scripts.

Three services. Two build from this repo + root directory; the hourly poll is
a plain `curlimages/curl` image that hits the web service's sync endpoint:

| Service | Source | Start command | Schedule |
|---|---|---|---|
| `coach-app` (web) | this repo | `npm start` (after `npm run build`) | always on |
| `cron-weekly` | this repo | `npm run cron:weekly` | `0 18 * * 0` (Sunday 18:00 UTC) |
| `cron-fallback-poll` | image `curlimages/curl` | `/bin/sh -c 'exec curl -sSf --max-time 900 -X POST --oauth2-bearer "$INTERNAL_API_TOKEN" "$APP_BASE_URL/api/internal/sync"'` | `0 * * * *` (hourly) |

The `/bin/sh -c` wrapper on `cron-fallback-poll` is load-bearing. Railway runs
a Docker-image service's start command in exec form, replacing the image's
entrypoint, so without a shell `$APP_BASE_URL` and `$INTERNAL_API_TOKEN` are
passed to curl as literal text and every run crashes with
`curl: (3) URL rejected: Bad hostname`. `--oauth2-bearer` sends the same
`Authorization: Bearer …` header the route checks, without nested quoting.
`-f` turns a non-2xx response into a non-zero exit so a broken token or a
failing sync shows up as a crashed run rather than a silent success.

Two Railway behaviours to know when changing that service: "Redeploy" clones
the previous deployment's snapshot, old start command included, so a
start-command change only takes effect after a genuine new deployment (the
Deploy button, or `serviceInstanceDeployV2` via the API). A cron-schedule
change, by contrast, is picked up by the existing deployment without one.

Add Railway's managed Postgres plugin to the project and attach it to
`coach-app` and `cron-weekly` so `DATABASE_URL` is injected automatically. Set
the other env vars from `.env.example` on both; `cron-fallback-poll` only needs
`APP_BASE_URL` and `INTERNAL_API_TOKEN`.

After first deploy: run migrations + seed once (`railway run npm run
db:migrate && npm run db:seed`), then visit `/connect/strava?token=...` on
the deployed `web` URL to authorize, then register the Strava webhook
subscription (one-time setup script, added alongside the commentary
feature) pointed at `${APP_BASE_URL}/api/webhooks/strava`.
