"use client";

import { BarChart, Bar, XAxis, YAxis, CartesianGrid, Tooltip, ResponsiveContainer, ReferenceLine } from "recharts";
import { chartColors } from "@/lib/chartColors";
import { ChartTooltip } from "./ChartTooltip";
import type { WeeklyIntensityPoint } from "@/lib/dashboard/queries";

function weekLabel(dateStr: string): string {
  return new Date(`${dateStr}T00:00:00Z`).toLocaleDateString("en-GB", { month: "short", day: "numeric" });
}

/** Weekly time-in-zone (low/moderate/high) vs. Seiler's 80/20 reference line. */
export function IntensityDistributionChart({ data }: { data: WeeklyIntensityPoint[] }) {
  const chartData = data.map((d) => ({
    week: weekLabel(d.weekStart),
    low: d.lowPercent,
    moderate: d.moderatePercent,
    high: d.highPercent,
  }));

  return (
    <div className="rounded-xl border border-border bg-surface p-5 shadow-card">
      <div className="mb-4">
        <h2 className="text-sm font-semibold text-ink-primary">Weekly intensity distribution</h2>
        <p className="mt-0.5 text-xs text-ink-muted">% of weekly run time low / moderate / high HR — 80/20 target overlaid</p>
      </div>
      <ResponsiveContainer width="100%" height={220}>
        <BarChart data={chartData} margin={{ top: 8, right: 8, left: 0, bottom: 0 }}>
          <CartesianGrid vertical={false} stroke={chartColors.gridline} strokeDasharray="0" />
          <XAxis
            dataKey="week"
            axisLine={{ stroke: chartColors.axis }}
            tickLine={false}
            tick={{ fill: chartColors.inkMuted, fontSize: 11 }}
            interval="preserveStartEnd"
          />
          <YAxis
            axisLine={false}
            tickLine={false}
            tick={{ fill: chartColors.inkMuted, fontSize: 11 }}
            width={36}
            tickFormatter={(v: number) => `${v}%`}
            domain={[0, 100]}
          />
          <ReferenceLine
            y={80}
            stroke={chartColors.inkMuted}
            strokeDasharray="4 4"
            label={{ value: "80/20 target", position: "insideTopLeft", fill: chartColors.inkMuted, fontSize: 10 }}
          />
          <Tooltip
            cursor={{ fill: chartColors.gridline, opacity: 0.4 }}
            content={({ active, label, payload }) => (
              <ChartTooltip
                active={active}
                label={label}
                payload={payload
                  ?.slice()
                  .reverse()
                  .map((p) => ({ name: p.name as string, value: p.value as number, color: p.color }))}
                formatValue={(v) => `${v}%`}
              />
            )}
          />
          <Bar dataKey="low" name="Low" stackId="intensity" fill={chartColors.zones[0]} maxBarSize={28} />
          <Bar dataKey="moderate" name="Moderate" stackId="intensity" fill={chartColors.zones[2]} maxBarSize={28} />
          <Bar dataKey="high" name="High" stackId="intensity" fill={chartColors.zones[4]} maxBarSize={28} />
        </BarChart>
      </ResponsiveContainer>
    </div>
  );
}
