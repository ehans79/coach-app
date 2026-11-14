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

### Following an externally-built plan

When Edu is following a plan built somewhere else (currently a Runna plan),
that plan owns the *structure* and this app owns the coaching on top of it.
`PlanDocument.externalPlan` holds a per-week skeleton — which day carries
which session, its type, distance and target zone — and
`regeneratePlanForNextWeek` enforces it: the Sunday job may still rewrite
pacing, HR targets, strength sessions and the rationale, but it cannot move,
resize, add or drop a session, and it no longer clamps distances to its own
volume guardrails (the external plan owns periodisation). Where a guardrail
and the pinned week disagree the pinned week wins, and the conflict is
recorded in `guardrails_applied.warnings` rather than silently applied.

Import or re-import the current Runna block with:

```bash
npx tsx scripts/import-runna-plan.ts --dry-run   # build and validate, write nothing
npx tsx scripts/import-runna-plan.ts             # insert as a new active version
```

The script validates every strength exercise name against the Garmin catalog
before writing, marks already-completed sessions from synced Strava
activities, and supersedes the previous active plan rather than editing it.
After importing, re-run matching and commentary for activities inside the
imported date range so the dashboard judges them against the new
prescriptions — the old comments were written against the superseded plan.

The skeleton is only as detailed as its source. Runna's one-page PDF export
gives each session's day, headline distance and Runna's own name for it
("Extended Kms", "Mile Repeats") but no rep breakdown; the per-session reps
and target paces come from the Runna app itself and are transcribed into
`RUNNA_WEEKS`. `assertDistances()` fails the import if any session's steps
don't sum to the PDF's headline distance, which is the check that catches a
bad transcription before it reaches the database.

One consequence worth remembering when reading the plan: Runna's Sunday "long
runs" are paced sessions, not easy runs, so only the Friday easy runs and the
warm-up/cool-down segments carry the Zone 2 heart-rate ceiling. Prescribing
the Sunday runs as Zone 1-2 is what made the app read correctly-executed
sessions as Zone 3 drift, and then cut volume in response.

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

## Putting the app on hold

Coaching has an on/off switch, for off-season breaks — a gym block over
winter, say. While it's held, the app is inert: the history stays browsable at
its URL, it just stops growing, and Postgres keeps every row for when training
resumes.

Flip it at `${APP_BASE_URL}/settings?token=<INTERNAL_API_TOKEN>` — the same
token gate as `/connect/strava`, since the app has no user auth of its own and
this page writes. It is deliberately absent from the nav (a nav link would 404
for anyone without the token); a banner on the dashboard reports the state
instead, which needs no token to read. Bookmark the URL.

Three things write to the database, and the switch covers all three:

1. **The Strava push subscription**, which fires on every upload — including
   `WeightTraining` and `Ride`, not just runs. Taking the hold deletes it and
   resuming re-creates it, in the same click; left live, a gym block gets
   synced, matched against a running plan that no longer applies, and
   commented on at Anthropic's expense.
2. **`cron-fallback-poll`**, hourly — which writes a daily-load rollup on
   every run even when nothing new has synced. Held, it gets
   `{"paused":true}` in about two seconds and exits clean.
3. **`cron-weekly`**, Sundays — which writes a new plan version, a coach's
   read, and emails the debrief. Held, it exits before any of it.

The state lives in the `app_settings` singleton row (`src/lib/pause.ts`), so
all three read one source of truth with no redeploy, and `pausedAt` doubles as
the backfill start date on the way back. Reads fail closed: a settings row the
app can't query is not a database it should be writing coaching decisions
into.

`COACH_PAUSED=true` in the environment forces the hold on and **cannot be
lifted from the UI** — that asymmetry is the point, since it's the one hold
that survives someone reaching the public URL. Use it for a deploy-level stop;
use the toggle for everything else. Set it on `coach-app` and `cron-weekly`
(not `cron-fallback-poll`, which only curls the web service). The settings
page says when it's what's holding things, rather than letting the toggle
appear to work and change nothing.

Coming back is three steps, and `/settings` lists them with the dates filled
in: resume from the toggle, `npm run strava:backfill -- <YYYY-MM-DD>` for the
gap, then decide what plan it picks up. That last one matters — the Sunday job
keeps authoring its own weeks once an external plan's skeleton runs out, so a
long hold usually wants a freshly imported block rather than a continuation of
a finished one.
