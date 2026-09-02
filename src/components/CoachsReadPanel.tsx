import { Badge } from "@/components/Badge";
import type { CoachsRead, CoachsReadFreshness } from "@/lib/coaching/coachsRead";

function formatWeekRange(start: string, end: string): string {
  const opts: Intl.DateTimeFormatOptions = { month: "short", day: "numeric", timeZone: "UTC" };
  const s = new Date(`${start}T00:00:00Z`).toLocaleDateString("en-GB", opts);
  const e = new Date(`${end}T00:00:00Z`).toLocaleDateString("en-GB", opts);
  return `${s} – ${e}`;
}

/**
 * The synthesized opening paragraph — the same stored text the weekly debrief
 * email leads with, so the two never say different things about the same week.
 * Deliberately the only accent-ruled block on Trends: everything below it is
 * evidence, and this is the one place the app speaks about all of it at once.
 *
 * Once the read goes stale it gives that rule up. Every panel below is queried
 * live, so an old paragraph presented as current is the one way this page can
 * contradict itself — the same reasoning behind VdotPanel's out-of-date state,
 * and the same treatment: keep the text, mute it, say plainly how old it is.
 */
export function CoachsReadPanel({
  read,
  freshness,
}: {
  read: CoachsRead | null;
  freshness: CoachsReadFreshness | null;
}) {
  if (!read) {
    return (
      <div className="rounded-2xl border border-border bg-surface p-6 shadow-card">
        <div className="flex items-center gap-2">
          <span className="h-2 w-2 shrink-0 rounded-full bg-ink-muted" />
          <span className="text-xs font-bold tracking-wide text-ink-muted uppercase">Coach&rsquo;s read</span>
        </div>
        <p className="mt-2 text-sm leading-relaxed text-ink-secondary">
          Written once a week, during Sunday&rsquo;s review, from everything on this page. The first one appears after
          that job next runs.
        </p>
      </div>
    );
  }

  const isStale = freshness?.isStale === true;
  const weekRange = formatWeekRange(read.weekStartDate, read.weekEndDate);

  return (
    <section
      className={isStale ? "rounded-2xl border border-border bg-surface p-6 shadow-card" : "rounded-2xl bg-surface p-6 shadow-pop"}
      style={{ borderLeft: `4px solid ${isStale ? "var(--axis)" : "var(--accent)"}` }}
      aria-labelledby="coachs-read-heading"
    >
      <div className="flex flex-wrap items-center gap-x-2 gap-y-1">
        <span
          className="h-2 w-2 shrink-0 rounded-full"
          style={{ backgroundColor: isStale ? "var(--ink-muted)" : "var(--accent)" }}
        />
        <h2 id="coachs-read-heading" className="text-xs font-bold tracking-wide text-ink-muted uppercase">
          Coach&rsquo;s read
        </h2>
        <span className="text-xs text-ink-muted">&middot; week of {weekRange}</span>
        {isStale && (
          <span className="ml-auto">
            <Badge tone="neutral" label={freshness!.ageLabel!} />
          </span>
        )}
      </div>

      <p
        className={`mt-3 text-lg leading-relaxed font-medium text-pretty ${isStale ? "text-ink-secondary" : "text-ink-primary"}`}
      >
        {read.summaryText}
      </p>

      {isStale ? (
        <p className="mt-3 text-xs leading-relaxed text-ink-muted">
          Sunday&rsquo;s review hasn&rsquo;t written a new one since the week of {weekRange}, so this describes that
          week rather than where you are now &mdash; everything below it is current. Worth checking the weekly job ran.
        </p>
      ) : (
        <p className="mt-3 text-xs leading-relaxed text-ink-muted">
          {read.isSparse
            ? `Read from ${read.availableReadCount} of ${read.totalReadCount} signals — most of the rest need more training history before they say anything. Everything below is the detail behind it.`
            : `Read across ${read.availableReadCount} of ${read.totalReadCount} signals. Everything below is the detail behind it.`}
        </p>
      )}
    </section>
  );
}
