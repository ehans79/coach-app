import { getZoneReference } from "@/lib/dashboard/queries";

export const dynamic = "force-dynamic";
import { Card } from "@/components/Card";
import { EmptyState } from "@/components/EmptyState";
import { Badge } from "@/components/Badge";

const ZONE_COLOR = ["var(--zone-1)", "var(--zone-2)", "var(--zone-3)", "var(--zone-4)", "var(--zone-5)"];

const STALE_THRESHOLD_DAYS = 180;

export default async function ZonesPage() {
  const zones = await getZoneReference();

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
        {isPaceLikelyStale && <Badge tone="warning" label="Pace zones may be stale" />}
      </div>

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
              {zones.paceZones.map((z) => (
                <tr key={z.zone} className="border-t border-gridline">
                  <td className="py-2 whitespace-nowrap">
                    Zone {z.zone} — {z.name}
                  </td>
                  <td className="py-2 whitespace-nowrap text-ink-secondary tabular-nums">{z.paceMinPerKm}/km</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
        <p className="mt-4 text-xs text-ink-muted">{zones.source}</p>
      </Card>
    </div>
  );
}
