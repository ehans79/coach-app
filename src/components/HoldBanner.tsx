import { daysSince, type HoldState } from "@/lib/pause";

/**
 * Says plainly that the app is on hold, so a dashboard that has stopped moving
 * reads as a decision rather than a bug. Needs no token — it only reports
 * state; flipping it lives behind /settings.
 */
export function HoldBanner({ hold }: { hold: HoldState }) {
  if (!hold.paused) return null;

  return (
    <section
      className="rounded-xl border border-border p-5 shadow-card"
      style={{ backgroundColor: "var(--status-warning-soft)", borderLeft: "4px solid var(--status-warning)" }}
    >
      <div className="flex items-center gap-2">
        <span
          className="h-2 w-2 shrink-0 rounded-full"
          style={{ backgroundColor: "var(--status-warning)" }}
        />
        <span className="text-xs font-bold tracking-wide text-ink-muted uppercase">Coaching on hold</span>
      </div>
      <p className="mt-2 text-sm leading-relaxed text-ink-secondary">
        Nothing is syncing, and the plan isn&apos;t regenerating
        {hold.since && ` — on hold ${daysSince(hold.since)} days now`}. Everything below is the picture as
        of then.
        {hold.note && <span className="italic"> “{hold.note}”</span>}
      </p>
    </section>
  );
}
