"use client";

import { ComposedChart, Line, XAxis, YAxis, CartesianGrid, Tooltip, ResponsiveContainer, ReferenceLine } from "recharts";
import { chartColors } from "@/lib/chartColors";
import { ChartTooltip } from "./ChartTooltip";
import type { DailyLoadPoint } from "@/lib/dashboard/queries";

function dateLabel(dateStr: string): string {
  return new Date(`${dateStr}T00:00:00Z`).toLocaleDateString("en-GB", { month: "short", day: "numeric" });
}

const SERIES = [
  { key: "ctl", name: "CTL (fitness)", color: chartColors.accent },
  { key: "atl", name: "ATL (fatigue)", color: chartColors.inkSecondary },
  { key: "tsb", name: "TSB (form)", color: chartColors.zones[3] },
] as const;

/** The weekly Performance Management centerpiece — 42-day CTL, 7-day ATL, TSB = CTL - ATL. */
export function CtlAtlTsbChart({ data }: { data: DailyLoadPoint[] }) {
  const chartData = data.map((d) => ({ date: dateLabel(d.date), ctl: d.ctl, atl: d.atl, tsb: d.tsb }));

  return (
    <div className="rounded-2xl bg-surface p-6 shadow-pop">
      <div className="mb-4">
        <div className="text-sm font-bold text-ink-primary">Fitness / fatigue / form</div>
        <div className="text-xs text-ink-muted">42-day CTL, 7-day ATL, TSB = CTL − ATL (yesterday)</div>
      </div>
      <ResponsiveContainer width="100%" height={280}>
        <ComposedChart data={chartData} margin={{ top: 8, right: 8, left: 0, bottom: 0 }}>
          <CartesianGrid vertical={false} stroke={chartColors.gridline} strokeDasharray="0" />
          <ReferenceLine y={0} stroke={chartColors.axis} />
          <XAxis
            dataKey="date"
            axisLine={{ stroke: chartColors.axis }}
            tickLine={false}
            tick={{ fill: chartColors.inkMuted, fontSize: 11 }}
            interval="preserveStartEnd"
          />
          <YAxis axisLine={false} tickLine={false} tick={{ fill: chartColors.inkMuted, fontSize: 11 }} width={36} />
          <Tooltip
            content={({ active, label, payload }) => (
              <ChartTooltip
                active={active}
                label={label}
                payload={payload?.map((p) => ({
                  name: SERIES.find((s) => s.key === p.dataKey)?.name ?? (p.dataKey as string),
                  value: Math.round((p.value as number) * 10) / 10,
                  color: p.color,
                }))}
              />
            )}
          />
          {SERIES.map((s) => (
            <Line key={s.key} type="monotone" dataKey={s.key} name={s.name} stroke={s.color} strokeWidth={2} dot={false} />
          ))}
        </ComposedChart>
      </ResponsiveContainer>
    </div>
  );
}
