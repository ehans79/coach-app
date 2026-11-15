import { notFound } from "next/navigation";
import { getEnv } from "@/lib/env";
import { daysSince, getHoldState } from "@/lib/pause";
import { listPushSubscriptions } from "@/lib/strava/client";
import { blockStartDate, getDefaultFreshBlockSetting } from "@/lib/coaching/freshBlock";
import type { TrainingSetting } from "@/lib/coaching/setting";
import { Card } from "@/components/Card";
import { SubmitButton } from "@/components/SubmitButton";
import { setHoldAction, startFreshBlockAction } from "./actions";

// Hold state is flipped here and read by the cron jobs; never serve a cached view of it.
export const dynamic = "force-dynamic";

function formatDate(d: Date): string {
  return d.toLocaleDateString("en-GB", { day: "numeric", month: "long", year: "numeric" });
}

function isoDate(d: Date): string {
  return d.toISOString().slice(0, 10);
}

const BLOCK_OUTCOME: Record<string, string> = {
  "env-hold":
    "COACH_PAUSED is set on the server, so coaching can't be resumed from here and no plan was built.",
  "sync-failed":
    "Coaching is resumed, but Strava couldn't be read, so no plan was built — it would have been sized from out-of-date history. Try again in a few minutes.",
  "build-failed":
    "Coaching is resumed and Strava is synced, but writing the plan failed. Nothing was changed; try again, and if it keeps failing the server log has the reason.",
};

const PRIMARY_BUTTON =
  "rounded-md bg-accent px-4 py-2.5 text-sm font-semibold text-white disabled:cursor-not-allowed disabled:opacity-40";

function Choice({
  name,
  value,
  defaultChecked,
  title,
  detail,
}: {
  name: string;
  value: string;
  defaultChecked: boolean;
  title: string;
  detail: string;
}) {
  return (
    <label className="flex cursor-pointer items-start gap-2.5 rounded-md border border-border bg-surface px-3 py-2">
      <input type="radio" name={name} value={value} defaultChecked={defaultChecked} className="mt-1 accent-accent" />
      <span>
        <span className="block text-sm font-medium text-ink-primary">{title}</span>
        <span className="block text-xs text-ink-secondary">{detail}</span>
      </span>
    </label>
  );
}

/**
 * The choices a new block is built from. Whatever is submitted here is stored
 * on the plan (PlanDocument.setting), so the Sunday job keeps to it every week
 * after — this is the one place it is chosen.
 */
function FreshBlockFields({ setting }: { setting: TrainingSetting }) {
  return (
    <div className="flex flex-col gap-4">
      <fieldset className="flex flex-col gap-2">
        <legend className="mb-1.5 text-xs font-bold tracking-wide text-ink-muted uppercase">Running</legend>
        <Choice
          name="running"
          value="treadmill"
          defaultChecked={setting.running === "treadmill"}
          title="Treadmill"
          detail="Belt speeds in km/h, incline, and timed steps you can follow at the console."
        />
        <Choice
          name="running"
          value="outdoor"
          defaultChecked={setting.running === "outdoor"}
          title="Outdoors"
          detail="Distances and paces in min/km."
        />
      </fieldset>

      <fieldset className="flex flex-col gap-2">
        <legend className="mb-1.5 text-xs font-bold tracking-wide text-ink-muted uppercase">Strength</legend>
        <Choice
          name="strength"
          value="gym"
          defaultChecked={setting.strength === "gym"}
          title="Gym"
          detail="Machines, cables and dumbbells — no barbell lifts, nothing that needs a spotter."
        />
        <Choice
          name="strength"
          value="bodyweight"
          defaultChecked={setting.strength === "bodyweight"}
          title="Bodyweight at home"
          detail="Circuits with no equipment."
        />
      </fieldset>

      <label className="flex cursor-pointer items-start gap-2.5">
        <input type="checkbox" name="explain" defaultChecked={setting.explainExercises} className="mt-1 accent-accent" />
        <span>
          <span className="block text-sm font-medium text-ink-primary">Explain every exercise</span>
          <span className="block text-xs text-ink-secondary">
            How to set the machine up, how to do one rep, and how to pick a starting weight — written under each
            exercise in the session.
          </span>
        </span>
      </label>

      <label className="flex flex-col gap-1.5">
        <span className="text-sm font-medium text-ink-primary">Never include</span>
        <input
          type="text"
          name="avoid"
          defaultValue={setting.avoidExercises.join(", ")}
          maxLength={200}
          placeholder="e.g. Bench Press, Burpee"
          className="rounded-md border border-border bg-surface px-3 py-2 text-sm text-ink-primary placeholder:text-ink-muted"
        />
        <span className="text-xs text-ink-secondary">
          Comma-separated. Every variation of each is left out of every session, this week and after.
        </span>
      </label>
    </div>
  );
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
  searchParams: Promise<{ token?: string; block?: string }>;
}) {
  const { token, block } = await searchParams;
  if (token !== getEnv().INTERNAL_API_TOKEN) notFound();

  const hold = await getHoldState();
  const blockSetting = await getDefaultFreshBlockSetting();
  const blockOutcome = block ? BLOCK_OUTCOME[block] : undefined;
  const todayStr = isoDate(new Date());
  const blockStart = blockStartDate(todayStr);
  const blockStartLabel =
    blockStart <= todayStr ? "this week" : `on Monday ${formatDate(new Date(`${blockStart}T00:00:00Z`))}`;

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

      {blockOutcome && (
        <p
          role="alert"
          className="mb-4 rounded-xl border border-border p-4 text-sm leading-relaxed text-ink-primary"
          style={{
            backgroundColor: "var(--status-critical-soft)",
            borderLeft: "4px solid var(--status-critical)",
          }}
        >
          {blockOutcome}
        </p>
      )}

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

        {paused ? (
          <>
            {/* Coming back is one click: resume, read the gap from Strava, write week 1. */}
            <form action={startFreshBlockAction} className="mt-5 flex flex-col gap-4 border-t border-border pt-4">
              <input type="hidden" name="token" value={token} />
              <div>
                <p className="text-sm font-semibold text-ink-primary">Come back with a new plan</p>
                <p className="mt-1 text-sm leading-relaxed text-ink-secondary">
                  Resumes coaching, reads everything Strava has from the time away, and writes week 1 of a new
                  block from it, starting {blockStartLabel}. The plan you were on before is kept in the history
                  but not continued.
                </p>
              </div>
              <FreshBlockFields setting={blockSetting} />
              <SubmitButton
                disabled={hold.envOverride}
                pendingLabel="Reading Strava and writing your plan — about two minutes…"
                className={PRIMARY_BUTTON}
              >
                Resume coaching and build my plan
              </SubmitButton>
            </form>

            <form action={setHoldAction} className="mt-3">
              <input type="hidden" name="token" value={token} />
              <input type="hidden" name="intent" value="resume" />
              <SubmitButton
                disabled={hold.envOverride}
                pendingLabel="Resuming…"
                className="text-sm font-medium text-ink-secondary underline underline-offset-2 disabled:cursor-not-allowed disabled:opacity-40"
              >
                Resume without a new plan
              </SubmitButton>
            </form>
          </>
        ) : (
          <form action={setHoldAction} className="mt-4 flex flex-col gap-3">
            <input type="hidden" name="token" value={token} />
            <input type="hidden" name="intent" value="hold" />
            <input
              type="text"
              name="note"
              maxLength={120}
              placeholder="Why, in a few words — e.g. winter gym block"
              className="rounded-md border border-border bg-surface px-3 py-2 text-sm text-ink-primary placeholder:text-ink-muted"
            />
            <SubmitButton pendingLabel="Putting coaching on hold…" className={PRIMARY_BUTTON}>
              Put coaching on hold
            </SubmitButton>
          </form>
        )}
      </section>

      {!paused && (
        <Card
          title="Start a fresh block"
          subtitle="A new plan from your recent Strava history, replacing the current one"
          className="mt-4"
        >
          <form action={startFreshBlockAction} className="flex flex-col gap-4">
            <input type="hidden" name="token" value={token} />
            <p className="text-sm leading-relaxed text-ink-secondary">
              For changing where you train — moving indoors for winter, or back outside — or starting over after a
              block ends. Syncs Strava first, then writes week 1 starting {blockStartLabel}. The Sunday job carries
              on from week 2 with the same choices.
            </p>
            <FreshBlockFields setting={blockSetting} />
            <SubmitButton
              pendingLabel="Reading Strava and writing your plan — about two minutes…"
              className={PRIMARY_BUTTON}
            >
              Build a fresh block
            </SubmitButton>
          </form>
        </Card>
      )}

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

      {paused && (
        <Card title="When you come back" className="mt-4">
          <ul className="flex flex-col gap-3 text-sm text-ink-secondary">
            <li>
              <span className="font-medium text-ink-primary">Resume coaching and build my plan</span> does all of
              it: lifts the hold, re-creates the Strava webhook, syncs the gap, and writes a new week 1 sized from
              what you actually did while away. A long hold almost always wants this one.
            </li>
            <li>
              <span className="font-medium text-ink-primary">Resume without a new plan</span> only lifts the hold.
              Use it after a short pause, when the plan you were on still has a week covering today — the Sunday
              job can only extend a plan that does, and stops with an error otherwise.
            </li>
          </ul>
        </Card>
      )}
    </div>
  );
}
