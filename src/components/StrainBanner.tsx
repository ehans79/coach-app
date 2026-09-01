import type { StrainAssessment } from "@/lib/metrics/strain";

const TONE = {
  elevated: { dot: "var(--status-warning)", bg: "var(--status-warning-soft)", rule: "var(--status-warning)" },
  high: { dot: "var(--status-serious)", bg: "var(--status-serious-soft)", rule: "var(--status-serious)" },
} as const;

/**
 * The composite training-strain flag — a banner, deliberately not a chart. It only
 * renders when at least two independent signals fired (see strain.ts); a single
 * borderline number never puts anything on screen. The fired signals are listed
 * underneath so the flag is always readable as evidence rather than a verdict.
 */
export function StrainBanner({ assessment }: { assessment: StrainAssessment }) {
  if (!assessment.triggered) return null;
  const tone = assessment.severity === "high" ? TONE.high : TONE.elevated;
  const fired = assessment.signals.filter((s) => s.fired);

  return (
    <section
      className="rounded-xl border border-border p-5 shadow-card"
      style={{ backgroundColor: tone.bg, borderLeft: `4px solid ${tone.rule}` }}
    >
      <div className="flex items-center gap-2">
        <span className="h-2 w-2 shrink-0 rounded-full" style={{ backgroundColor: tone.dot }} />
        <span className="text-xs font-bold tracking-wide text-ink-muted uppercase">Fatigue check</span>
      </div>
      <p className="mt-2 text-base leading-snug font-bold text-ink-primary text-balance">{assessment.headline}</p>
      <p className="mt-2 text-sm leading-relaxed text-ink-secondary">{assessment.body}</p>

      <ul className="mt-3 flex flex-col gap-1.5">
        {fired.map((signal) => (
          <li key={signal.key} className="flex gap-2 text-sm text-ink-secondary">
            <span aria-hidden className="mt-1.5 h-1.5 w-1.5 shrink-0 rounded-full" style={{ backgroundColor: tone.dot }} />
            <span>
              <span className="font-medium text-ink-primary">{signal.label}:</span> {signal.detail}
            </span>
          </li>
        ))}
      </ul>
    </section>
  );
}

/**
 * The same four signals with their full reasoning, fired or not — the "show your
 * working" companion to the banner. Lives on Trends, where the reader has already
 * opted into the detail, rather than on the week view.
 */
export function StrainSignalTable({ assessment }: { assessment: StrainAssessment }) {
  return (
    <div className="flex flex-col gap-3">
      {assessment.signals.map((signal) => {
        const dot = !signal.assessable
          ? "var(--ink-muted)"
          : signal.fired
            ? signal.strong
              ? "var(--status-serious)"
              : "var(--status-warning)"
            : "var(--status-good)";
        return (
          <div key={signal.key} className="flex gap-2.5">
            <span aria-hidden className="mt-1.5 h-2 w-2 shrink-0 rounded-full" style={{ backgroundColor: dot }} />
            <div>
              <div className="text-sm font-medium text-ink-primary">
                {signal.label}
                {!signal.assessable && <span className="ml-2 text-xs font-normal text-ink-muted">not enough data yet</span>}
              </div>
              <p className="mt-0.5 text-sm leading-relaxed text-ink-secondary">{signal.detail}</p>
            </div>
          </div>
        );
      })}
      <p className="mt-1 border-t border-gridline pt-3 text-xs leading-relaxed text-ink-muted">
        Two of these have to be outside their range at once before anything is flagged. There is no single validated
        marker for overreaching — these are patterns worth noticing, not a diagnosis.
      </p>
    </div>
  );
}
