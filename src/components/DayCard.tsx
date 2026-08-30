import { Badge, flagToBadge } from "@/components/Badge";
import { StrengthSessionDetail } from "@/components/StrengthSessionDetail";
import { formatKm, formatDuration } from "@/lib/format";
import type { ThisWeekWorkout } from "@/lib/dashboard/queries";

const SPORT_LABEL: Record<string, string> = {
  run: "Run",
  strength: "Strength",
  bike: "Ride",
};

function shortDay(dayOfWeek: string): string {
  return dayOfWeek.slice(0, 3);
}

function zonePillLabel(primaryZone: string | null): string | null {
  if (!primaryZone || primaryZone.toUpperCase().startsWith("N/A")) return null;
  return primaryZone.replace(/\s*\(.*\)$/, ""); // "Zone 1-2 (HR <156bpm)" -> "Zone 1-2"
}

export function DayCard({ workout, isToday }: { workout: ThisWeekWorkout; isToday: boolean }) {
  const w = workout;
  const zoneLabel = zonePillLabel(w.primaryZone);

  return (
    <div
      className={`flex min-h-[150px] flex-col gap-2 rounded-xl bg-surface p-3.5 shadow-card ${
        isToday ? "ring-2 ring-accent" : ""
      } ${w.completed ? "opacity-80" : ""}`}
    >
      <div className="flex items-start justify-between gap-2">
        <div className="min-w-0">
          <div className="text-[10.5px] font-bold uppercase tracking-wide text-ink-muted">{shortDay(w.dayOfWeek)}</div>
          <div className="text-[10px] font-semibold uppercase tracking-wide text-accent-ink">
            {SPORT_LABEL[w.sport] ?? w.sport}
          </div>
        </div>
        {w.completed && (
          <span className="flex h-5 w-5 shrink-0 items-center justify-center rounded-full bg-status-good text-[11px] font-bold text-white">
            ✓
          </span>
        )}
      </div>

      <div className="text-sm leading-tight font-bold text-ink-primary">{w.name}</div>

      <div className="mt-auto flex flex-wrap gap-1.5">
        {w.distanceMeters != null && (
          <span className="w-fit rounded-full bg-surface-sunken px-2 py-0.5 text-[10.5px] font-semibold text-ink-secondary tabular-nums">
            {formatKm(w.distanceMeters)}
          </span>
        )}
        {w.durationMinutes != null && (
          <span className="w-fit rounded-full bg-surface-sunken px-2 py-0.5 text-[10.5px] font-semibold text-ink-secondary tabular-nums">
            {formatDuration(w.durationMinutes * 60)}
          </span>
        )}
        {zoneLabel && (
          <span className="w-fit rounded-full bg-surface-sunken px-2 py-0.5 text-[10.5px] font-semibold text-ink-secondary">
            {zoneLabel}
          </span>
        )}
      </div>

      {w.humanReadable && (
        <details className="group mt-1 border-t border-border pt-2">
          <summary className="cursor-pointer list-none text-[11px] font-semibold text-accent-ink select-none">
            <span className="group-open:hidden">Full session</span>
            <span className="hidden group-open:inline">Hide</span>
          </summary>
          <div className="mt-2">
            {w.sport === "strength" ? (
              <StrengthSessionDetail text={w.humanReadable} />
            ) : (
              <p className="text-xs leading-relaxed whitespace-pre-line text-ink-secondary">{w.humanReadable}</p>
            )}
          </div>
        </details>
      )}

      {w.comment && (
        <div className="mt-1 rounded-lg bg-page p-3">
          <div className="mb-1">
            <Badge {...flagToBadge(w.comment.flag)} />
          </div>
          <p className="text-xs leading-snug text-ink-secondary">{w.comment.commentText}</p>
        </div>
      )}
    </div>
  );
}
