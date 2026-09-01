import type { ReactNode } from "react";
import { Badge } from "@/components/Badge";
import { EmptyState } from "@/components/EmptyState";
import { formatDuration, formatPace, formatPaceClock } from "@/lib/format";
import type { VdotView } from "@/lib/dashboard/queries";

function changeLabel(delta: number): { tone: "good" | "warning" | "neutral"; label: string } {
  if (delta >= 0.3) return { tone: "good", label: `+${delta.toFixed(1)} since last effort` };
  if (delta <= -0.3) return { tone: "warning", label: `${delta.toFixed(1)} since last effort` };
  return { tone: "neutral", label: "Level with last effort" };
}

/**
 * Current VDOT, how it moved, and the Daniels paces it produces. The trend chart is
 * passed as a child so this stays a server component while the Recharts view stays a
 * client one.
 */
export function VdotPanel({ view, children }: { view: VdotView; children: ReactNode }) {
  const { current, changeVsPrevious, paces, activeThreshold, lastKnown } = view;

  if (!current) {
    return (
      <div className="rounded-2xl bg-surface p-6 shadow-pop">
        <div className="mb-4 flex flex-wrap items-start justify-between gap-3">
          <div>
            <div className="text-sm font-bold text-ink-primary">Estimated fitness (VDOT)</div>
            <div className="text-xs text-ink-muted">
              From a race or a hard, evenly-paced sustained effort, via the Daniels-Gilbert equations
            </div>
          </div>
          {lastKnown && <Badge tone="neutral" label="Out of date" />}
        </div>

        {lastKnown ? (
          <>
            <div className="flex flex-wrap items-baseline gap-x-4 gap-y-1">
              <span className="font-mono text-4xl font-extrabold tracking-tight text-ink-muted tabular-nums">
                {lastKnown.vdot.toFixed(1)}
              </span>
              <span className="text-sm text-ink-secondary">last measured {lastKnown.daysAgo} days ago</span>
            </div>
            <p className="mt-1 text-xs text-ink-muted">
              {lastKnown.activityName} · {lastKnown.effortDate}
            </p>
            <p className="mt-3 text-sm leading-relaxed text-ink-secondary">
              That&rsquo;s too long ago to describe your fitness now, so it isn&rsquo;t setting your training paces.
              One race or hard time-trial-style run brings this back to life.
            </p>
            <div className="mt-5">{children}</div>
          </>
        ) : (
          <EmptyState message="No race-quality effort detected yet — VDOT appears after your first race or hard time-trial-style run." />
        )}

        {activeThreshold && (
          <p className="mt-4 text-xs leading-relaxed text-ink-muted">
            {lastKnown ? "Meanwhile, training" : "Until then, training"} load is computed against a threshold pace of{" "}
            <span className="font-medium text-ink-secondary">{formatPace(activeThreshold.thresholdPaceSecPerKm)}</span>
            {activeThreshold.isProvisional ? " — a provisional estimate that a real effort will replace." : "."}
          </p>
        )}
      </div>
    );
  }

  const change = changeVsPrevious ? changeLabel(changeVsPrevious.delta) : null;

  return (
    <div className="rounded-2xl bg-surface p-6 shadow-pop">
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div>
          <div className="text-sm font-bold text-ink-primary">Estimated fitness (VDOT)</div>
          <div className="text-xs text-ink-muted">
            Best qualifying effort in the last {view.windowDays} days, via the Daniels-Gilbert equations
          </div>
        </div>
        {change && <Badge tone={change.tone} label={change.label} />}
      </div>

      <div className="mt-4 flex flex-wrap items-baseline gap-x-4 gap-y-1">
        <span className="font-mono text-4xl font-extrabold tracking-tight text-ink-primary tabular-nums">
          {current.vdot.toFixed(1)}
        </span>
        <span className="text-sm text-ink-secondary">
          from {current.distanceKm.toFixed(2)}km in {formatDuration(current.durationSeconds)}
        </span>
      </div>
      <p className="mt-1 text-xs text-ink-muted">
        {current.activityName} · {current.effortDate} ({current.daysAgo === 0 ? "today" : `${current.daysAgo}d ago`}) ·{" "}
        {current.source === "strava_race" ? "tagged as a race in Strava" : "detected time-trial-quality effort"}
      </p>

      <div className="mt-5">{children}</div>

      {paces.length > 0 && (
        <div className="mt-5 border-t border-gridline pt-4">
          <div className="text-xs font-medium text-ink-muted">Training paces from this VDOT</div>
          <div className="mt-2 overflow-x-auto">
            <table className="w-full text-sm">
              <tbody>
                {paces.map((p) => (
                  <tr key={p.key} className="border-t border-gridline first:border-t-0">
                    <td className="w-full py-2 pr-3 whitespace-nowrap">
                      <span className="font-medium text-ink-primary">{p.name}</span>
                      <span className="ml-1.5 text-ink-muted">({p.key})</span>
                    </td>
                    {/* Right-aligned: in the wide Trends column an auto-width value cell
                        otherwise floats in the middle with dead space on both sides. */}
                    <td className="py-2 text-right whitespace-nowrap text-ink-secondary tabular-nums">
                      {formatPaceClock(p.fastSecPerKm)}&ndash;{formatPaceClock(p.slowSecPerKm)}/km
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </div>
      )}

      {activeThreshold && (
        <p className="mt-4 text-xs leading-relaxed text-ink-muted">
          Training load is computed against a threshold pace of{" "}
          <span className="font-medium text-ink-secondary">{formatPace(activeThreshold.thresholdPaceSecPerKm)}</span>
          {activeThreshold.derivedFromVdot
            ? " — the Daniels T pace from this VDOT. It applies to runs from here on; already-computed rTSS keeps the threshold it was measured against."
            : activeThreshold.isProvisional
              ? " — still the provisional pre-VDOT estimate. It updates on the next sync after a qualifying effort."
              : "."}
        </p>
      )}
    </div>
  );
}
