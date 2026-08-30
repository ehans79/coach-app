"use client";

import { BarChart, Bar, XAxis, YAxis, CartesianGrid, Tooltip, Legend, ResponsiveContainer } from "recharts";
import { chartColors } from "@/lib/chartColors";
import { ChartTooltip } from "./ChartTooltip";
import type { ZoneWeekPoint } from "@/lib/dashboard/queries";

const ZONE_KEYS = ["zone1", "zone2", "zone3", "zone4", "zone5"] as const;
const ZONE_NAMES = ["Zone 1", "Zone 2", "Zone 3", "Zone 4", "Zone 5"];

function weekLabel(dateStr: string): string {
  return new Date(`${dateStr}T00:00:00Z`).toLocaleDateString("en-GB", { month: "short", day: "numeric" });
}

export function ZoneTrendChart({ data }: { data: ZoneWeekPoint[] }) {
  const chartData = data.map((d) => ({ week: weekLabel(d.weekStart), ...d }));

  return (
    <ResponsiveContainer width="100%" height={280}>
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
          tickFormatter={(v) => `${v}%`}
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
        <Legend
          wrapperStyle={{ fontSize: 12, color: chartColors.inkSecondary }}
          formatter={(value) => <span style={{ color: chartColors.inkSecondary }}>{value}</span>}
        />
        {ZONE_KEYS.map((key, i) => (
          <Bar
            key={key}
            dataKey={key}
            name={ZONE_NAMES[i]}
            stackId="zones"
            fill={chartColors.zones[i]}
            stroke={chartColors.surface}
            strokeWidth={2}
            maxBarSize={28}
          />
        ))}
      </BarChart>
    </ResponsiveContainer>
  );
}
