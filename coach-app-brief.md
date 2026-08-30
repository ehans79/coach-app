# Personal Coach App — Project Brief (for Claude Code)

## What this is

A personal training app for Edu that pulls data from Strava and **automatically regenerates his running training plan every Sunday evening**, based on recent training trends (compliance, zone adherence, fatigue signals) — rather than a static plan that never adapts. It also **posts a coach's comment on the dashboard right after each run or workout syncs from Strava**, telling Edu how that session went, what to watch out for, and what to correct. Right after the Sunday regeneration runs, it **emails Edu a visual weekly debrief** covering how the past week went and what's coming next week. Single-user, no auth. Light theme only everywhere — dashboard and emails. Deployed on Railway.

This brief captures the decisions made so far and the reference material (coaching logic, data shapes, API surface) needed to build it. Open questions are flagged explicitly — resolve them as you go.

---

## Decisions locked in

| Area | Decision |
|---|---|
| Core feature (v1) | Full plan regeneration, run automatically, based on recent trends (not just a manual "flag drift" tool) |
| Trigger | Automatic, weekly, **Sunday evening** (end of the training week / start of the next) |
| Core feature (v1) #2 | Per-activity coach commentary — a short note after every run/workout on how it went, what to watch for, what to correct |
| Trigger #2 | As soon as the activity syncs from Strava (near real-time, via Strava webhook) |
| Feedback delivery | Per-activity comments live on the dashboard only, attached to the activity — no push/Strava-comment posting for that feature |
| Core feature (v1) #3 | Weekly email debrief — visual report covering the past week's performance and a preview of next week |
| Trigger #3 | Sunday evening, chained right after the plan-regeneration job finishes (not a separate schedule) |
| Units | Metric throughout, European/Portugal conventions — km and m for distance, kg for weight, °C for temperature, pace as min:sec/km. No imperial units or conversions anywhere in the app. |
| Theme | **Light theme only, everywhere** — dashboard and email report. No dark mode, and don't auto-switch based on the system/browser's `prefers-color-scheme` — always render light. |
| Interface | Web dashboard — modern, interactive, crisp visual bar. More detailed than a static plan viewer: should show history/trends, not just "this week" |
| Data storage | Postgres on Railway |
| Auth | None — single user, hardcode Edu's own Strava connection |
| Stack | Open — pick what best supports a modern React-ish dashboard + a scheduled backend job + Postgres on Railway. (Next.js + a Postgres ORM like Prisma/Drizzle is a reasonable default if you want one, but not mandated.) |

---

## Core feature: weekly plan regeneration

Every Sunday evening, the app should:

1. **Pull the past week's activities** from Strava (see API surface below) — actual runs completed, distances, durations, HR streams.
2. **Compare planned vs. actual**: did the athlete hit the prescribed sessions? Did "easy" runs stay in the intended HR zone, or drift into a harder zone (this exact problem came up in manual testing — see "Known real example" below)? Missed sessions, extra sessions, RPE/effort trend.
3. **Re-assess form**: rolling volume trend, consistency, any signs of overreaching (see Load Management reference below) or under-load (plan was too easy, athlete could progress faster).
4. **Regenerate the next week (or next block)** of the plan: adjust volume, session types, and long-run progression based on that assessment — not just blindly incrementing by a fixed %.
5. **Persist the new plan version** to Postgres (keep history — don't overwrite; the dashboard should be able to show how the plan evolved over time and why).
6. **Surface the reasoning**, not just the output — the dashboard should show *why* the plan changed this week (e.g., "long run bumped only slightly because Tuesday's run ran hot into Zone 3 again").

### Architecture choice to make: heuristics vs. LLM-driven regeneration

"Regenerate based on trends" is a genuinely judgment-heavy coaching task (this is what a human coach — or this chat session — does by reasoning over the data holistically). Two viable approaches, worth deciding early:

- **Rule-based heuristics**: encode the periodization/load rules below directly as code (e.g., "if compliance > 90% and no zone violations, increase long run by 10%; if a session was missed, hold volume flat"). Predictable, cheap, fully offline, but limited nuance.
- **LLM-assisted regeneration**: have the backend job call the Claude API (Anthropic API, e.g. via the Messages API) with the athlete's recent activity data + current plan + the coaching reference material below as context, and have Claude produce the next week's plan (similar to what happened in this conversation, but automated). More flexible and can explain its reasoning in natural language for the dashboard, at the cost of an API dependency and less deterministic output — worth validating/bounding its output (e.g., cap week-over-week volume change) so it can't prescribe something unsafe.

A hybrid is also reasonable: heuristics compute hard guardrails (max % volume change, mandatory recovery weeks every 3-4 weeks), and the LLM fills in workout specifics/rationale within those bounds.

---

## Core feature: per-activity coach commentary

As soon as a run or workout syncs in from Strava, the app should generate a short coach's comment and attach it to that activity on the dashboard — this is the same kind of feedback given manually earlier (see "Known real example" below): how the session went, what to watch out for, and what (if anything) to correct next time.

1. **Detect the new activity** as close to real-time as possible. Strava supports push subscriptions (webhooks) for this — the app should subscribe once (`POST /push_subscriptions`) and expose a public callback endpoint that Strava calls when Edu completes and uploads an activity, rather than polling.
2. **Fetch the activity's detail + streams** (see API surface below) — HR and cadence streams at minimum; pace/elevation if useful for the specific session type. Also pull the activity's start location + timestamp for weather context (see below).
3. **Look up what was actually prescribed** for that day from the current plan (matching by date/day-of-week) — the comment should be relative to the plan, not generic ("this was supposed to be an easy Zone 2 run, but...").
4. **Generate the comment**, covering (mirroring the depth of the manual zone-drift analysis done in testing):
   - Did the effort match the prescription (zone adherence, pacing, duration/distance vs. planned)?
   - Anything notable in the data (e.g., a session that ran much hotter or easier than intended, an unusually high/low relative effort for the distance, a big pace fade in a long run)?
   - **Cadence**: flag if it's noticeably low (a common, correctable form issue — e.g., overstriding) or drops off late in a run (fatigue/form breakdown), relative to Edu's own recent-average cadence rather than a generic universal target.
   - **Weather context**: if it was hot, humid, or otherwise tough out there, factor that in before judging the effort — a run that ran hot on HR during a heatwave isn't the same problem as one that ran hot on a mild day. Worth surfacing in the comment either way ("it was 29°C — some of that elevated HR is heat, not pace").
   - A concrete, short correction or reminder if something's off (e.g., "keep the HR ceiling at 156bpm on easy days"), or a quick affirmation if the session executed as planned — the tone should read like a coach, not a data dump.
5. **Persist the comment** alongside the activity in Postgres, and surface it immediately on the dashboard's activity view/feed.

### Weather data source

Strava itself only exposes a `temp` stream (ambient temperature, if the recording device has a sensor — often absent, e.g. on a phone-only recording). For real weather context (temperature, humidity, wind — the stuff that actually explains an elevated HR), the app will likely need a small third-party historical-weather API call using the activity's start lat/lng + timestamp (e.g., Open-Meteo's free historical-weather API needs no key at all, or Visual Crossing/OpenWeatherMap if a fuller feature set is wanted). Cheap, low-effort addition: one extra API call per new activity, cached alongside the comment so it isn't refetched.

This shares most of its plumbing with the weekly regeneration feature (Strava data fetch, zone-adherence logic, current-plan lookup) — likely worth factoring the "compare this run against its prescription" logic into one shared module both features call, rather than duplicating it. It's also a natural candidate for the same heuristics-vs-LLM choice discussed above; a short natural-language comment is arguably an even better fit for an LLM call than the full plan regeneration is, since the output is just prose rather than a structured plan that needs bounding.

---

## Core feature: weekly email debrief

Right after the Sunday plan-regeneration job finishes, send Edu a visual HTML email summarizing the week that just ended and previewing the week ahead. Content and format decisions below — flagged as recommendations, easy to change:

**Content:**
- **Header**: week date range, one-line overall verdict (e.g., "Solid week — back on track after last week's dip")
- **This week's performance**: planned vs. completed sessions (simple visual checklist, e.g., 3/3 runs done), total distance/time, a small zone-adherence chart (% time in each HR zone, since this is the specific pattern Edu wanted to watch), and 1-2 highlight call-outs pulled from that week's per-activity comments (especially anything flagged `watch`/`correct`)
- **Next week preview**: the newly regenerated plan's sessions at a glance (day, session type, target distance/zone), plus a short "why it changed" note carried over from the regeneration step's rationale (e.g., "long run holds flat this week since Friday's run ran hot again")
- **Footer**: a link back to the full dashboard for anyone who wants to dig into a specific activity

**Format:**
- Visual HTML email, **light theme only** (per the global theme decision), built with inlined CSS and a table-based layout for broad email-client compatibility (Gmail/Outlook/Apple Mail all render HTML email inconsistently if you rely on modern CSS)
- Charts need to be static images, not interactive JS — most email clients strip `<script>` and often CSS-based charts too. Render charts server-side to PNG/SVG (a lightweight headless chart lib, or a service like QuickChart.io) and embed them inline
- Recommended stack: a transactional email API such as Resend (pairs nicely with React Email for building the visual template if the app is Next.js-based) or Postmark — either works fine, pick whichever fits the chosen stack
- Recipient: Edu's own address, via an env var (e.g., `NOTIFY_EMAIL`) rather than hardcoded in source

---

## Strava API surface needed

Edu has a Strava MCP connector working already in Claude (`https://mcp.strava.com/mcp`), but this app will talk to Strava directly via OAuth + the REST API (v3), since it needs to run unattended on a schedule. Needed endpoints (Strava API v3 names):

- `GET /oauth/token` — OAuth2 token exchange + refresh (standard Strava auth flow: Client ID + Secret from strava.com/settings/api, authorization code grant, refresh token stored server-side since there's no user present when the Sunday job runs)
- `GET /athlete` — profile (weight, measurement preference, `current_focus` goal text)
- `GET /athlete/zones` — HR zones (5-zone, MaxHR-based for Edu currently), power zones, run pace zones
- `GET /athlete/activities` — list activities (supports `after`/`before` epoch timestamps for date range, pagination)
- `GET /activities/{id}` — full activity detail (relative effort/suffer_score, avg HR, cadence, PRs)
- `GET /activities/{id}/streams` — time-series streams (`heart_rate`, `time`, `distance`, `velocity_smooth`, `cadence`, `latlng`, `temp`, etc.) — needed for the zone-adherence check, cadence analysis, and (start location) the weather lookup
- `POST /push_subscriptions` (one-time setup) + a public callback endpoint on the app (e.g. `GET`/`POST /webhooks/strava`) — Strava's webhook system, needed for the near-real-time per-activity commentary feature. Strava pings the callback with just an activity id/owner id on create; the app then calls back into `GET /activities/{id}` (+ streams) to fetch the actual data. Note the callback endpoint needs a `GET` handshake (echoing a `hub.challenge` query param) before Strava will start sending events.

**Important**: since this runs unattended (no user clicking through OAuth each time), store Strava's refresh token securely (Postgres, or Railway secret) and refresh access tokens automatically before each run — access tokens expire in ~6 hours.

### Known real example (for testing/calibration)

On 2026-06-30, an activity labeled "Easy Run" (Strava activity id `19120822241`) spent **78.5% of its time in Zone 3 (Tempo, 157-171bpm)** and only 17% in Zone 2 (Aerobic, 126-156bpm) — despite being prescribed as an easy/aerobic session. This is a real, useful test case for the "did the easy run stay easy" check the regeneration logic should perform.

---

## Athlete seed data (Edu, as of Aug 2026)

Use this to seed the DB / test the regeneration logic realistically:

- Measurement preference: Metric — European/Portugal conventions specifically (km, m, kg, °C). Note: Strava's REST API always returns raw values in metric base units (meters, meters/second, kilograms, seconds) regardless of the athlete's `measurement_preference` field — that field only affects Strava's own UI. So no unit *conversion* is needed, just consistent metric *formatting* on the dashboard (km with one decimal for distances, min:sec/km for pace, whole-number °C, etc.) — never surface miles, feet, °F, or lbs anywhere.
- HR zones (MaxHR-based, 5-zone): Z1 Recovery 0-125bpm · Z2 Aerobic 126-156bpm · Z3 Tempo 157-171bpm · Z4 Threshold 172-186bpm · Z5 VO2max+ 187+bpm
- Run pace zones (RacePace-based, from a 35:00 5K best effort — likely stale, flagged for retesting): Z1 8:53+/km · Z2 7:39-8:53/km · Z3 6:52-7:39/km · Z4 6:26-6:52/km · Z5 6:03-6:26/km · Z6 <6:03/km
- Currently mid-way through a hand-built 6-week "Return to Running" plan (2026-08-31 to 2026-10-11), rebuilding from an 8-9 week break (life/work, not injury). Runs Tue/Fri/Sun, 2 beginner gym strength sessions/week (Mon/Thu). See the delivered plan JSON (`return-to-running-2026-10-11.json`) for the exact structure/schema this app's plans should probably be compatible with.
- Longer training history available via Strava: consistent structured running roughly Aug 2025-Jun 2026 (10K-focused block Oct-Dec 2025, speed-focused block Jan-Apr 2026), including a lower-leg/shin issue and recovery block around Aug 2025 — worth the regeneration logic staying conservative on volume ramp-rate given that history.
- Stated Strava profile goal (`current_focus`): "Increase my VO2 max to get faster," expiring 2026-10-31.

---

## Coaching reference logic (for the regeneration engine)

Pulled from the same coaching reference material used to hand-build Edu's current plan — encode whichever of these are relevant to your chosen architecture (as rules, or as context fed to an LLM call):

**Progressive overload / ramp rate** (by athlete state):
- True beginner: 5-10%/week volume increase
- Some experience (1-2yr): 10%/week
- Strong foundation, returning from a break: 10-15%/week ("body remembers")
- Recent high fitness, no break: maintain or small build
- Time off due to *injury* → more caution than time off due to *life circumstances*

**Loading pattern**: 3 weeks building + 1 recovery week (30-40% volume cut) is standard; 2:1 for beginners/injury-prone. Recovery weeks: no Zone 4+ work, 40-50% of normal week's volume.

**Long-run progression**: never increase by more than ~2-3km/week (running).

**Weekly structure principles**: no same sport back-to-back hard days; 48hr between quality sessions; easy day after long runs; consistent weekly schedule.

**Intensity distribution (polarized model)**: 75-80% of weekly volume easy (Zone 1-2), 5-10% moderate (Zone 3 — deliberately minimized, this is the "gray zone"), 15-20% hard (Zone 4-5).

**Recovery/overreaching signals worth tracking** (if available): resting HR trend, subjective sleep/energy/soreness, elevated suffer_score relative to distance.

---

## Suggested Postgres data model (starting point, adjust freely)

- `athlete` — profile snapshot, zones (versioned by `as_of_date` since zones can be recalculated)
- `activities` — cached Strava activities (avoid re-fetching everything every run; incremental sync by date)
- `activity_streams` — cached HR/time streams for activities that need zone analysis (or fetch on demand and cache selectively)
- `plans` — one row per generated plan version, with a `generated_at`, `week_start_date`, full plan JSON (see schema below), and a `rationale` text field (why it changed from the previous version)
- `plan_weeks` / `plan_workouts` — normalized if you want the dashboard to query/filter individual sessions rather than just rendering a JSON blob
- `activity_comments` — one row per activity: the generated coach commentary text, generated_at timestamp, cached weather snapshot (temp/conditions at start time+location), and ideally a structured verdict field or two (e.g., `zone_adherence: ok|drifted`, `flag: none|watch|correct`) so the dashboard can show a quick visual status without parsing the prose
- `email_reports` — light log of sent weekly debriefs (sent_at, which plan version it covered, delivery status) — mostly for debugging/history; the report content itself can be regenerated on demand from `plans` + `activity_comments` rather than stored separately

### Plan JSON shape to stay compatible with

The coach skill (used to hand-build Edu's current plan) outputs plans in this shape — reuse it so existing tooling (the HTML renderer, etc.) stays compatible: `meta` (id/athlete/event/dates), `preferences` (units), `assessment` (foundation/currentForm/strengths/limiters/constraints), `zones` (hr/pace), `phases` (macro blocks), `weeks[].days[].workouts[]` (the actual prescriptions, each with sport/type/name/description/durationMinutes/distanceMeters/primaryZone/humanReadable). Full example available in the delivered `return-to-running-2026-10-11.json` file.

---

## Dashboard — suggested views

- **This week**: current plan for the week, with completion status per session (cross-reference against synced Strava activities) — each completed session shows its coach's comment right there (how it went, what to watch for/correct)
- **Activity feed**: reverse-chronological list of recent activities, each with its coach's comment, cadence and weather snapshot, and a quick status flag (on-target / watch / correct)
- **Trends**: weekly volume over time, long-run progression chart, zone-adherence-over-time (% time in each zone per week — directly useful given the recurring "easy run runs hot" pattern)
- **Plan history**: timeline of plan versions with the rationale for each change — this is the "why did my plan change" view
- **Zone/pace reference**: current HR and pace zones, with a reminder of when they were last validated (flag if the pace zones are stale / based on an old race time)

---

## Deployment (Railway)

- Web service (dashboard + API) — Railway auto-detects most modern frameworks
- Postgres — Railway's managed Postgres plugin
- Scheduled job for Sunday evening regeneration — Railway supports cron-triggered services; alternatively run an in-process scheduler (e.g., `node-cron`) inside the web service if a separate service feels like overkill for v1
- The Strava webhook callback (for per-activity commentary) needs a stable public HTTPS URL — Railway's web service gives you this by default, just make sure the webhook route is reachable pre-auth (no login gate on that one endpoint)
- Environment variables needed: Strava `CLIENT_ID` / `CLIENT_SECRET` / stored refresh token, a `STRAVA_VERIFY_TOKEN` (arbitrary secret you choose, used in the webhook handshake), `DATABASE_URL` (Railway provides this automatically for its Postgres plugin), an Anthropic API key if going the LLM-assisted route for either feature, a weather API key if using a provider that requires one (Open-Meteo's historical API doesn't), an email provider API key (e.g., `RESEND_API_KEY`), and `NOTIFY_EMAIL` (Edu's own address, where the weekly debrief gets sent)

---

## Open questions to resolve while building

- Heuristic vs. LLM-driven regeneration (see architecture section above) — biggest undecided fork
- Exact dashboard tech (React/Next.js recommended given the "modern, interactive, crisp" bar, but not mandated)
- How much manual override the dashboard should allow (e.g., can Edu edit a generated plan directly, or is it read-only until the next Sunday run?)
- Chart-rendering approach for the email (headless chart lib vs. an external image-generation service like QuickChart.io) — pick whatever's least friction in the chosen stack
- Should per-activity commentary cover every synced activity (rides, walks, strength sessions too) or only the ones that map to a prescribed plan session? Non-plan activities (like Edu's easy bike rides) could still get a lighter "how was this" note, or be skipped entirely — worth deciding once the plan-matching logic exists
- Webhook delivery isn't fully guaranteed by Strava (occasional missed events) — worth a periodic fallback poll (e.g., hourly check for any activity without a comment yet) so a missed webhook doesn't mean a session never gets feedback
