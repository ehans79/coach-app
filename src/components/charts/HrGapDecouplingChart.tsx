"use client";

import { ComposedChart, Line, XAxis, YAxis, CartesianGrid, Tooltip, ResponsiveContainer, ReferenceArea } from "recharts";
import { chartColors } from "@/lib/chartColors";
import { ChartTooltip } from "./ChartTooltip";
import { formatDuration, formatPace } from "@/lib/format";
import type { ActivityHrGapPoint } from "@/lib/dashboard/queries";

/** HR + grade-adjusted pace over the run duration — the core decoupling visual, second half shaded. */
export function HrGapDecouplingChart({ data }: { data: ActivityHrGapPoint[] }) {
  const secondHalfStart = data.find((d) => d.half === "second")?.t;
  const lastT = data[data.length - 1]?.t;

  return (
    <div className="rounded-2xl bg-surface p-6 shadow-pop">
      <div className="mb-4">
        <div className="text-sm font-bold text-ink-primary">Heart rate vs. grade-adjusted pace</div>
        <div className="text-xs text-ink-muted">Shaded region marks the second half — where aerobic decoupling shows up</div>
      </div>
      <ResponsiveContainer width="100%" height={260}>
        <ComposedChart data={data} margin={{ top: 8, right: 8, left: 0, bottom: 0 }}>
          <CartesianGrid vertical={false} stroke={chartColors.gridline} strokeDasharray="0" />
          {secondHalfStart != null && lastT != null && (
            <ReferenceArea
              yAxisId="hr"
              x1={secondHalfStart}
              x2={lastT}
              fill={chartColors.gridline}
              fillOpacity={0.5}
              strokeOpacity={0}
            />
          )}
          <XAxis
            dataKey="t"
            type="number"
            domain={["dataMin", "dataMax"]}
            axisLine={{ stroke: chartColors.axis }}
            tickLine={false}
            tick={{ fill: chartColors.inkMuted, fontSize: 11 }}
            tickFormatter={(v: number) => formatDuration(v)}
          />
          <YAxis
            yAxisId="hr"
            axisLine={false}
            tickLine={false}
            tick={{ fill: chartColors.inkMuted, fontSize: 11 }}
            width={36}
          />
          <YAxis
            yAxisId="gap"
            orientation="right"
            reversed
            axisLine={false}
            tickLine={false}
            tick={{ fill: chartColors.inkMuted, fontSize: 11 }}
            width={52}
            tickFormatter={(v: number) => formatPace(v)}
          />
          <Tooltip
            content={({ active, label, payload }) => (
              <ChartTooltip
                active={active}
                label={typeof label === "number" ? formatDuration(label) : label}
                payload={payload?.map((p) => ({
                  name: p.dataKey === "hr" ? "Heart rate" : "GAP pace",
                  value: p.dataKey === "hr" ? `${p.value}bpm` : formatPace(p.value as number),
                  color: p.dataKey === "hr" ? chartColors.accent : chartColors.inkSecondary,
                }))}
              />
            )}
          />
          <Line
            yAxisId="hr"
            type="monotone"
            dataKey="hr"
            stroke={chartColors.accent}
            strokeWidth={2}
            dot={false}
            connectNulls
          />
          <Line
            yAxisId="gap"
            type="monotone"
            dataKey="gapPaceSecPerKm"
            stroke={chartColors.inkSecondary}
            strokeWidth={2}
            dot={false}
            connectNulls
          />
        </ComposedChart>
      </ResponsiveContainer>
    </div>
  );
}
