import { notFound } from "next/navigation";
import { getEnv } from "@/lib/env";
import { daysSince, getHoldState } from "@/lib/pause";
import { listPushSubscriptions } from "@/lib/strava/client";
import { Card } from "@/components/Card";
import { setHoldAction } from "./actions";

// Hold state is flipped here and read by the cron jobs; never serve a cached view of it.
export const dynamic = "force-dynamic";

function formatDate(d: Date): string {
  return d.toLocaleDateString("en-GB", { day: "numeric", month: "long", year: "numeric" });
}

function isoDate(d: Date): string {
  return d.toISOString().slice(0, 10);
}

/**
 * The on/off switch for coaching, gated by INTERNAL_API_TOKEN in the query
 * string — the same gate as /connect/strava, and for the same reason: the app
 * has no user auth, so a page that writes can't be reachable from the public
 * dashboard. Bookmark `${APP_BASE_URL}/settings?token=…`.
 *
 * Deliberately not in the nav: a nav link would 404 for anyone browsing
 * normally, including Edu on a phone. The dashboard shows a hold banner
 * instead, which needs no token to read.
 */
export default async function SettingsPage({
  searchParams,
}: {
  searchParams: Promise<{ token?: string }>;
}) {
  const { token } = await searchParams;
  if (token !== getEnv().INTERNAL_API_TOKEN) notFound();

  const hold = await getHoldState();

  // Read live rather than inferred from the hold: if the action's Strava call
  // failed, this is where the mismatch becomes visible.
  let webhookLive: boolean | null = null;
  try {
    webhookLive = (await listPushSubscriptions()).length > 0;
  } catch {
    webhookLive = null;
  }

  const paused = hold.paused;
  const tone = paused
    ? { bg: "var(--status-warning-soft)", rule: "var(--status-warning)", dot: "var(--status-warning)" }
    : { bg: "var(--status-good-soft)", rule: "var(--status-good)", dot: "var(--status-good)" };

  return (
    <div className="mx-auto max-w-2xl">
      <h1 className="mb-6 text-xl font-semibold text-ink-primary">Settings</h1>

      <section
        className="rounded-xl border border-border p-5 shadow-card"
        style={{ backgroundColor: tone.bg, borderLeft: `4px solid ${tone.rule}` }}
      >
        <div className="flex items-center gap-2">
          <span className="h-2 w-2 shrink-0 rounded-full" style={{ backgroundColor: tone.dot }} />
          <span className="text-xs font-bold tracking-wide text-ink-muted uppercase">Coaching</span>
        </div>
        <p className="mt-2 text-base leading-snug font-bold text-ink-primary">
          {paused ? "On hold" : "Active"}
          {paused && hold.since && (
            <span className="font-normal text-ink-secondary">
              {" "}
              since {formatDate(hold.since)} · {daysSince(hold.since)} days
            </span>
          )}
        </p>
        <p className="mt-2 text-sm leading-relaxed text-ink-secondary">
          {paused
            ? "Nothing is being synced, commented on, regenerated or emailed. The dashboard still shows everything up to the moment the hold started."
            : "Runs sync as they land, each gets a comment, the plan regenerates on Sunday evening and the debrief goes out after it."}
        </p>
        {hold.note && <p className="mt-2 text-sm text-ink-secondary italic">“{hold.note}”</p>}

        {hold.envOverride && (
          <p
            className="mt-3 rounded-md px-3 py-2 text-sm text-ink-secondary"
            style={{ backgroundColor: "var(--surface)" }}
          >
            <span className="font-semibold text-ink-primary">COACH_PAUSED is set on the server.</span>{" "}
            That hold wins over this toggle and can only be lifted by unsetting the variable on the{" "}
            <code className="font-mono text-xs">coach-app</code> and{" "}
            <code className="font-mono text-xs">cron-weekly</code> services in Railway.
          </p>
        )}

        <form action={setHoldAction} className="mt-4 flex flex-col gap-3">
          <input type="hidden" name="token" value={token} />
          <input type="hidden" name="intent" value={paused ? "resume" : "hold"} />
          {!paused && (
            <input
              type="text"
              name="note"
              maxLength={120}
              placeholder="Why, in a few words — e.g. winter gym block"
              className="rounded-md border border-border bg-surface px-3 py-2 text-sm text-ink-primary placeholder:text-ink-muted"
            />
          )}
          <button
            type="submit"
            disabled={hold.envOverride && paused}
            className="rounded-md bg-accent px-4 py-2.5 text-sm font-semibold text-white disabled:cursor-not-allowed disabled:opacity-40"
          >
            {paused ? "Resume coaching" : "Put coaching on hold"}
          </button>
        </form>
      </section>

      <Card
        title="What the switch covers"
        subtitle="The three things that write to the database"
        className="mt-4"
      >
        <ul className="flex flex-col gap-3 text-sm">
          <li>
            <div className="font-medium text-ink-primary">
              Strava webhook{" "}
              <span className="font-normal text-ink-muted">
                {webhookLive === null ? "— couldn't reach Strava" : webhookLive ? "— live" : "— deleted"}
              </span>
            </div>
            <p className="text-ink-secondary">
              Fires on every upload, gym sessions and rides included. Deleted when the hold goes on and
              re-created when it comes off, by the button above.
            </p>
          </li>
          <li>
            <div className="font-medium text-ink-primary">Hourly fallback poll</div>
            <p className="text-ink-secondary">
              {paused
                ? "Still wakes up each hour, gets a paused response in about two seconds, and writes nothing."
                : "Catches anything the webhook missed, and rolls up daily training load."}
            </p>
          </li>
          <li>
            <div className="font-medium text-ink-primary">Sunday job, 18:00 UTC</div>
            <p className="text-ink-secondary">
              {paused
                ? "Starts, sees the hold, and exits — no plan version, no debrief email."
                : "Regenerates next week's plan, writes the coach's read, emails the debrief."}
            </p>
          </li>
        </ul>
      </Card>

      {paused && hold.since && (
        <Card title="When you come back" className="mt-4">
          <ol className="flex list-decimal flex-col gap-2 pl-4 text-sm text-ink-secondary">
            <li>Hit “Resume coaching” above — that also re-creates the Strava webhook.</li>
            <li>
              Backfill the gap:{" "}
              <code className="rounded bg-surface-sunken px-1.5 py-0.5 font-mono text-xs text-ink-primary">
                npm run strava:backfill -- {isoDate(hold.since)}
              </code>
            </li>
            <li>
              Decide what plan it picks up. The Sunday job authors its own weeks once an external
              plan&apos;s skeleton runs out, so a long hold usually wants a freshly imported block rather
              than a continuation of a finished one.
            </li>
          </ol>
        </Card>
      )}
    </div>
  );
}
