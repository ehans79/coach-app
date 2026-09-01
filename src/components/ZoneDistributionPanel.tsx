"use client";

import { useState } from "react";
import { formatDuration } from "@/lib/format";
import type { ActivityPowerView } from "@/lib/dashboard/queries";

const ZONE_COLOR = ["var(--zone-1)", "var(--zone-2)", "var(--zone-3)", "var(--zone-4)", "var(--zone-5)", "var(--zone-5)"];

interface HrZoneRow {
  /** Explicit — NOT the array index. Postgres jsonb does not preserve key insertion
   * order (it sorts keys by length, then bytewise), so the zone distribution comes back
   * from activity_comments.facts in an arbitrary order like 3,2,1,5,4. Inferring the
   * zone from position would mislabel every colour. */
  zone: number;
  label: string;
  percent: number;
}

/**
 * Time-in-zone for one run, switchable between the heart-rate zones the app has always
 * used and the % of Critical Power zones Stage 3 adds.
 *
 * A toggle rather than a replacement, deliberately: HR and power describe different
 * things (HR is the body's response and lags; power is mechanical output and doesn't),
 * and the wrist-power estimate isn't precise enough to justify demoting HR on its own.
 * The choice is per-run and not persisted — it's a way to look at a session, not a
 * setting to get wrong.
 */
export function ZoneDistributionPanel({
  hrZones,
  power,
  wristPowerCaveat,
}: {
  hrZones: HrZoneRow[];
  power: ActivityPowerView | null;
  wristPowerCaveat: string;
}) {
  const canShowPower = power != null && power.zones.length > 0;
  const [mode, setMode] = useState<"hr" | "power">("hr");
  const active = canShowPower ? mode : "hr";

  const rows =
    active === "power" && power
      ? power.zones.map((z) => ({
          key: `p${z.zone}`,
          zone: z.zone,
          label: `Zone ${z.zone} — ${z.name}`,
          detail: `${z.lowWatts}${z.highWatts != null ? `–${z.highWatts}` : "+"}W`,
          percent: z.percent,
          seconds: z.seconds,
        }))
      : hrZones.map((z, i) => ({
          key: `h${i}`,
          zone: z.zone,
          label: z.label,
          detail: null,
          percent: z.percent,
          seconds: null,
        }));

  return (
    <div>
      {canShowPower && (
        <div className="mb-3 inline-flex rounded-lg bg-surface-sunken p-0.5 text-xs font-medium">
          {(["hr", "power"] as const).map((m) => (
            <button
              key={m}
              type="button"
              onClick={() => setMode(m)}
              aria-pressed={active === m}
              className={`rounded-md px-2.5 py-1 transition-colors ${
                active === m ? "bg-surface text-ink-primary shadow-sm" : "text-ink-muted hover:text-ink-secondary"
              }`}
            >
              {m === "hr" ? "Heart rate" : "Power"}
            </button>
          ))}
        </div>
      )}

      <div className="flex flex-col gap-2">
        {rows.map((r) => (
          <div key={r.key} className="flex items-center gap-3 text-sm">
            <span className="w-44 shrink-0 truncate text-ink-secondary" title={r.label}>
              {r.label}
            </span>
            <span className="h-2 flex-1 overflow-hidden rounded-full bg-surface-sunken">
              <span
                className="block h-full rounded-full"
                style={{
                  width: `${Math.max(0, Math.min(100, r.percent))}%`,
                  backgroundColor: ZONE_COLOR[r.zone - 1] ?? "var(--ink-muted)",
                }}
              />
            </span>
            <span className="w-12 shrink-0 text-right font-medium text-ink-primary tabular-nums">
              {r.percent.toFixed(0)}%
            </span>
            {r.seconds != null && (
              <span className="w-14 shrink-0 text-right text-xs text-ink-muted tabular-nums">
                {formatDuration(r.seconds)}
              </span>
            )}
          </div>
        ))}
      </div>

      {active === "power" && power && (
        <div className="mt-3 border-t border-gridline pt-3">
          <div className="flex flex-wrap gap-x-6 gap-y-1 text-sm">
            <span className="text-ink-secondary">
              Avg <span className="font-medium text-ink-primary tabular-nums">{Math.round(power.avgWatts)}W</span>
            </span>
            <span className="text-ink-secondary">
              Normalized{" "}
              <span className="font-medium text-ink-primary tabular-nums">{Math.round(power.normalizedWatts)}W</span>
            </span>
            {power.percentOfCp != null && (
              <span className="text-ink-secondary">
                <span className="font-medium text-ink-primary tabular-nums">{power.percentOfCp.toFixed(0)}%</span> of CP
              </span>
            )}
          </div>
          {power.artifactSamples > 0 && (
            <p className="mt-2 text-xs text-ink-muted">
              {power.artifactSamples} implausible sample{power.artifactSamples === 1 ? "" : "s"} dropped as sensor
              artifacts before computing these.
            </p>
          )}
          <p className="mt-2 text-xs leading-relaxed text-ink-muted">{wristPowerCaveat}</p>
        </div>
      )}
    </div>
  );
}
