"use client";

import { BarChart, Bar, XAxis, YAxis, CartesianGrid, Tooltip, ResponsiveContainer } from "recharts";
import { chartColors } from "@/lib/chartColors";
import { ChartTooltip } from "./ChartTooltip";
import type { WeeklyVolumePoint } from "@/lib/dashboard/queries";

function weekLabel(dateStr: string): string {
  return new Date(`${dateStr}T00:00:00Z`).toLocaleDateString("en-GB", { month: "short", day: "numeric" });
}

export function WeeklyVolumeChart({ data }: { data: WeeklyVolumePoint[] }) {
  const chartData = data.map((d) => ({ week: weekLabel(d.weekStart), km: d.volumeKm }));

  return (
    <ResponsiveContainer width="100%" height={240}>
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
          tickFormatter={(v) => `${v}`}
        />
        <Tooltip
          cursor={{ fill: chartColors.gridline, opacity: 0.4 }}
          content={({ active, label, payload }) => (
            <ChartTooltip
              active={active}
              label={label}
              payload={payload?.map((p) => ({ name: "Volume", value: p.value as number, color: chartColors.accent }))}
              formatValue={(v) => `${v}km`}
            />
          )}
        />
        <Bar dataKey="km" fill={chartColors.accent} radius={[4, 4, 0, 0]} maxBarSize={24} />
      </BarChart>
    </ResponsiveContainer>
  );
}
