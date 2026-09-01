import { getZoneReference, getVdotView } from "@/lib/dashboard/queries";

export const dynamic = "force-dynamic";
import { Card } from "@/components/Card";
import { EmptyState } from "@/components/EmptyState";
import { Badge } from "@/components/Badge";
import { formatPace } from "@/lib/format";

const ZONE_COLOR = ["var(--zone-1)", "var(--zone-2)", "var(--zone-3)", "var(--zone-4)", "var(--zone-5)"];

const STALE_THRESHOLD_DAYS = 180;

export default async function ZonesPage() {
  const [zones, vdot] = await Promise.all([getZoneReference(), getVdotView()]);
  const purposeByZone = new Map(vdot.paces.map((p) => [p.zone, p.purpose]));

  if (!zones) {
    return (
      <div className="mx-auto max-w-2xl">
        <h1 className="mb-6 text-xl font-semibold text-ink-primary">Zones &amp; Pace</h1>
        <EmptyState message="No zone reference on file yet." />
      </div>
    );
  }

  const isPaceLikelyStale =
    zones.source.toLowerCase().includes("stale") || zones.daysSinceValidated > STALE_THRESHOLD_DAYS;

  return (
    <div className="mx-auto max-w-2xl">
      <div className="mb-6 flex flex-wrap items-start justify-between gap-4">
        <div>
          <h1 className="text-xl font-semibold text-ink-primary">Zones &amp; Pace</h1>
          <p className="mt-1 text-sm text-ink-secondary">Last validated {zones.daysSinceValidated} days ago ({zones.asOfDate})</p>
        </div>
        {vdot.current ? (
          <Badge tone="good" label={`VDOT ${vdot.current.vdot.toFixed(1)}`} />
        ) : (
          isPaceLikelyStale && <Badge tone="warning" label="Pace zones may be stale" />
        )}
      </div>

      {vdot.current && (
        <Card className="mb-4">
          <div className="text-xs font-medium text-ink-muted">Where these paces come from</div>
          <p className="mt-1.5 text-sm leading-relaxed text-ink-secondary">
            Derived from a VDOT of <span className="font-medium text-ink-primary">{vdot.current.vdot.toFixed(1)}</span>,
            computed via the Daniels-Gilbert equations from{" "}
            {vdot.current.source === "strava_race" ? "your race" : "a time-trial-quality effort"} on{" "}
            {vdot.current.effortDate} ({vdot.current.activityName}). Threshold pace{" "}
            {vdot.activeThreshold ? formatPace(vdot.activeThreshold.thresholdPaceSecPerKm) : "—"} is the Daniels T pace
            at 88% VO&#8322;max, and is what training load is scored against for runs from that date on.
          </p>
        </Card>
      )}

      <Card title="Heart rate zones" className="mb-4">
        <div className="overflow-x-auto">
          <table className="w-full text-sm">
            <thead>
              <tr className="text-left text-xs text-ink-muted">
                <th className="pb-2 font-medium">Zone</th>
                <th className="pb-2 font-medium">Range</th>
              </tr>
            </thead>
            <tbody>
              {zones.hrZones.map((z) => (
                <tr key={z.zone} className="border-t border-gridline">
                  <td className="py-2">
                    <span className="inline-flex items-center gap-2 whitespace-nowrap">
                      <span
                        className="h-2.5 w-2.5 shrink-0 rounded-full"
                        style={{ backgroundColor: ZONE_COLOR[z.zone - 1] ?? "var(--ink-muted)" }}
                      />
                      Zone {z.zone} — {z.name}
                    </span>
                  </td>
                  <td className="py-2 whitespace-nowrap text-ink-secondary tabular-nums">
                    {z.hrLow}–{z.hrHigh ?? "+"} bpm
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </Card>

      <Card title="Pace zones">
        <div className="overflow-x-auto">
          <table className="w-full text-sm">
            <thead>
              <tr className="text-left text-xs text-ink-muted">
                <th className="pb-2 font-medium">Zone</th>
                <th className="pb-2 font-medium">Pace</th>
              </tr>
            </thead>
            <tbody>
              {zones.paceZones.map((z) => {
                const purpose = purposeByZone.get(z.zone);
                return (
                  <tr key={z.zone} className="border-t border-gridline align-top">
                    <td className="py-2 pr-3">
                      <div className="whitespace-nowrap">
                        Zone {z.zone} — {z.name}
                      </div>
                      {purpose && <div className="mt-0.5 text-xs text-ink-muted">{purpose}</div>}
                    </td>
                    <td className="py-2 whitespace-nowrap text-ink-secondary tabular-nums">{z.paceMinPerKm}/km</td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>
        <p className="mt-4 text-xs text-ink-muted">{zones.source}</p>
      </Card>
    </div>
  );
}
