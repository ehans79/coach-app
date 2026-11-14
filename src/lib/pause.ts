/**
 * Off-season hold. With COACH_PAUSED set, every write path in the app turns
 * into a no-op: the Strava webhook acks and discards, the hourly fallback
 * poll syncs nothing, and the Sunday job neither regenerates the plan nor
 * emails the debrief. Reading the dashboard is unaffected — the history stays
 * browsable, it just stops growing.
 *
 * Read straight off process.env rather than through getEnv() so that a hold
 * can never itself fail on a missing/invalid unrelated variable, and so the
 * check is safe to make before anything else in a request or script.
 *
 * Returning from the hold is two steps, in either order: unset the variable
 * on the `coach-app` and `cron-weekly` Railway services, and re-create the
 * Strava push subscription with `npm run webhook:setup`. Anything that
 * happened during the hold is recoverable with
 * `npm run strava:backfill -- <YYYY-MM-DD>`.
 */
export function isPaused(): boolean {
  const raw = process.env.COACH_PAUSED?.trim().toLowerCase();
  return raw === "true" || raw === "1" || raw === "yes";
}
