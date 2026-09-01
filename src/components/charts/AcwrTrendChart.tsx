"use client";

import { ComposedChart, Line, XAxis, YAxis, CartesianGrid, Tooltip, ResponsiveContainer, ReferenceArea } from "recharts";
import { chartColors } from "@/lib/chartColors";
import { theme } from "@/lib/theme";
import { ChartTooltip } from "./ChartTooltip";
import type { DailyLoadPoint } from "@/lib/dashboard/queries";

function dateLabel(dateStr: string): string {
  return new Date(`${dateStr}T00:00:00Z`).toLocaleDateString("en-GB", { month: "short", day: "numeric" });
}

const SWEET_SPOT_MIN = 0.8;
const SWEET_SPOT_MAX = 1.3;
const DANGER_THRESHOLD = 1.5;
const CHART_CEILING = 2.2;

/**
 * ACWR over time — 0.8-1.3 "sweet spot" shaded green, >1.5 shaded red. Points
 * before 28 days of history are null (see rollup.ts), which Recharts'
 * default connectNulls={false} naturally breaks the line on.
 */
export function AcwrTrendChart({ data }: { data: DailyLoadPoint[] }) {
  const chartData = data.map((d) => ({ date: dateLabel(d.date), acwr: d.acwr }));

  return (
    <div className="rounded-xl border border-border bg-surface p-5 shadow-card">
      <div className="mb-4">
        <h2 className="text-sm font-semibold text-ink-primary">Acute:chronic workload ratio</h2>
        <p className="mt-0.5 text-xs text-ink-muted">
          Uncoupled 7-day vs. preceding 21-day load — 0.8-1.3 is the usual &quot;sweet spot&quot;
        </p>
      </div>
      <ResponsiveContainer width="100%" height={220}>
        <ComposedChart data={chartData} margin={{ top: 8, right: 8, left: 0, bottom: 0 }}>
          <CartesianGrid vertical={false} stroke={chartColors.gridline} strokeDasharray="0" />
          <ReferenceArea y1={SWEET_SPOT_MIN} y2={SWEET_SPOT_MAX} fill={theme.statusGoodSoft} fillOpacity={0.7} strokeOpacity={0} />
          <ReferenceArea y1={DANGER_THRESHOLD} y2={CHART_CEILING} fill={theme.statusCriticalSoft} fillOpacity={0.7} strokeOpacity={0} />
          <XAxis
            dataKey="date"
            axisLine={{ stroke: chartColors.axis }}
            tickLine={false}
            tick={{ fill: chartColors.inkMuted, fontSize: 11 }}
            interval="preserveStartEnd"
          />
          <YAxis
            axisLine={false}
            tickLine={false}
            tick={{ fill: chartColors.inkMuted, fontSize: 11 }}
            width={32}
            domain={[0, CHART_CEILING]}
          />
          <Tooltip
            content={({ active, label, payload }) => (
              <ChartTooltip
                active={active}
                label={label}
                payload={payload?.map((p) => ({
                  name: "ACWR",
                  value: Math.round((p.value as number) * 100) / 100,
                  color: chartColors.accent,
                }))}
              />
            )}
          />
          <Line type="monotone" dataKey="acwr" stroke={chartColors.accent} strokeWidth={2} dot={false} />
        </ComposedChart>
      </ResponsiveContainer>
    </div>
  );
}
