"use client";

import { LineChart, Line, XAxis, YAxis, CartesianGrid, Tooltip, ResponsiveContainer } from "recharts";
import { chartColors } from "@/lib/chartColors";
import { ChartTooltip } from "./ChartTooltip";
import type { WeeklyVolumePoint } from "@/lib/dashboard/queries";

function weekLabel(dateStr: string): string {
  return new Date(`${dateStr}T00:00:00Z`).toLocaleDateString("en-GB", { month: "short", day: "numeric" });
}

export function LongRunChart({ data }: { data: WeeklyVolumePoint[] }) {
  const chartData = data.map((d) => ({ week: weekLabel(d.weekStart), km: d.longestRunKm }));

  return (
    <ResponsiveContainer width="100%" height={240}>
      <LineChart data={chartData} margin={{ top: 8, right: 8, left: 0, bottom: 0 }}>
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
        />
        <Tooltip
          cursor={{ stroke: chartColors.axis, strokeWidth: 1 }}
          content={({ active, label, payload }) => (
            <ChartTooltip
              active={active}
              label={label}
              payload={payload?.map((p) => ({
                name: "Longest run",
                value: p.value as number,
                color: chartColors.accent,
              }))}
              formatValue={(v) => `${v}km`}
            />
          )}
        />
        <Line
          type="monotone"
          dataKey="km"
          stroke={chartColors.accent}
          strokeWidth={2}
          dot={{ r: 4, fill: chartColors.accent, stroke: chartColors.surface, strokeWidth: 2 }}
          activeDot={{ r: 5 }}
        />
      </LineChart>
    </ResponsiveContainer>
  );
}
