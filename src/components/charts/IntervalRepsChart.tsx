"use client";

import { ComposedChart, Bar, Line, XAxis, YAxis, CartesianGrid, Tooltip, ResponsiveContainer } from "recharts";
import { chartColors } from "@/lib/chartColors";
import { ChartTooltip } from "./ChartTooltip";
import { formatPace } from "@/lib/format";
import type { ActivityRepPoint } from "@/lib/dashboard/queries";

/** Per-rep pace/GAP + HR for interval-structured runs, fade % called out. */
export function IntervalRepsChart({ reps }: { reps: ActivityRepPoint[] }) {
  const workReps = reps.filter((r) => r.kind === "work");
  const lastFade = workReps.length > 0 ? workReps[workReps.length - 1].fadePercent : null;

  const chartData = workReps.map((r) => ({ rep: `Rep ${r.repIndex}`, gapPace: r.gapPaceSecPerKm, hr: r.avgHr }));

  return (
    <div className="rounded-2xl bg-surface p-6 shadow-pop">
      <div className="mb-4 flex items-start justify-between gap-4">
        <div>
          <div className="text-sm font-bold text-ink-primary">Per-rep breakdown</div>
          <div className="text-xs text-ink-muted">Grade-adjusted pace + heart rate per work interval</div>
        </div>
        {lastFade != null && (
          <div className="text-right">
            <div
              className={`text-sm font-bold tabular-nums ${lastFade > 5 ? "text-status-serious" : "text-status-good"}`}
            >
              {lastFade > 0 ? "+" : ""}
              {lastFade.toFixed(1)}%
            </div>
            <div className="text-[11px] text-ink-muted">fade, rep 1 → last</div>
          </div>
        )}
      </div>
      <ResponsiveContainer width="100%" height={240}>
        <ComposedChart data={chartData} margin={{ top: 8, right: 8, left: 0, bottom: 0 }}>
          <CartesianGrid vertical={false} stroke={chartColors.gridline} strokeDasharray="0" />
          <XAxis
            dataKey="rep"
            axisLine={{ stroke: chartColors.axis }}
            tickLine={false}
            tick={{ fill: chartColors.inkMuted, fontSize: 11 }}
          />
          <YAxis
            yAxisId="pace"
            reversed
            axisLine={false}
            tickLine={false}
            tick={{ fill: chartColors.inkMuted, fontSize: 11 }}
            width={52}
            tickFormatter={(v: number) => formatPace(v)}
          />
          <YAxis
            yAxisId="hr"
            orientation="right"
            axisLine={false}
            tickLine={false}
            tick={{ fill: chartColors.inkMuted, fontSize: 11 }}
            width={36}
          />
          <Tooltip
            cursor={{ fill: chartColors.gridline, opacity: 0.4 }}
            content={({ active, label, payload }) => (
              <ChartTooltip
                active={active}
                label={label}
                payload={payload?.map((p) => ({
                  name: p.dataKey === "gapPace" ? "GAP pace" : "Heart rate",
                  value: p.dataKey === "gapPace" ? formatPace(p.value as number) : `${p.value}bpm`,
                  color: p.dataKey === "gapPace" ? chartColors.accent : chartColors.inkSecondary,
                }))}
              />
            )}
          />
          <Bar yAxisId="pace" dataKey="gapPace" fill={chartColors.accent} radius={[4, 4, 0, 0]} maxBarSize={36} fillOpacity={0.85} />
          <Line
            yAxisId="hr"
            type="monotone"
            dataKey="hr"
            stroke={chartColors.inkSecondary}
            strokeWidth={2}
            dot={{ r: 4, fill: chartColors.inkSecondary, stroke: chartColors.surface, strokeWidth: 2 }}
          />
        </ComposedChart>
      </ResponsiveContainer>
    </div>
  );
}
