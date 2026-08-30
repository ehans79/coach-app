"use client";

import { ComposedChart, Bar, Line, XAxis, YAxis, CartesianGrid, Tooltip, ResponsiveContainer } from "recharts";
import { chartColors } from "@/lib/chartColors";
import { ChartTooltip } from "./ChartTooltip";
import { ROLLING_WEEKS } from "@/lib/dashboard/constants";
import type { WeeklyVolumePoint } from "@/lib/dashboard/queries";

function weekLabel(dateStr: string): string {
  return new Date(`${dateStr}T00:00:00Z`).toLocaleDateString("en-GB", { month: "short", day: "numeric" });
}

function trendDelta(data: WeeklyVolumePoint[]): { percent: number; direction: "up" | "down" } | null {
  if (data.length < 2) return null;
  const latest = data[data.length - 1];
  const priorWindow = data.slice(Math.max(0, data.length - 1 - ROLLING_WEEKS), data.length - 1);
  if (priorWindow.length === 0) return null;
  const priorAvg = priorWindow.reduce((sum, p) => sum + p.volumeKm, 0) / priorWindow.length;
  if (priorAvg === 0) return null;
  const percent = Math.round(((latest.volumeKm - priorAvg) / priorAvg) * 100);
  return { percent: Math.abs(percent), direction: percent >= 0 ? "up" : "down" };
}

export function TrainingLoadPanel({ data }: { data: WeeklyVolumePoint[] }) {
  const chartData = data.map((d) => ({ week: weekLabel(d.weekStart), km: d.volumeKm, avg: d.rollingAvgKm }));
  const delta = trendDelta(data);

  return (
    <div className="rounded-2xl bg-surface p-6 shadow-pop">
      <div className="mb-4 flex items-start justify-between gap-4">
        <div>
          <div className="text-sm font-bold text-ink-primary">Training load</div>
          <div className="text-xs text-ink-muted">Weekly volume · {ROLLING_WEEKS}-week rolling average</div>
        </div>
        {delta && (
          <div className="text-right">
            <div
              className={`text-sm font-bold tabular-nums ${delta.direction === "up" ? "text-status-good" : "text-status-serious"}`}
            >
              {delta.direction === "up" ? "▲" : "▼"} {delta.percent}%
            </div>
            <div className="text-[11px] text-ink-muted">vs {ROLLING_WEEKS}-wk avg</div>
          </div>
        )}
      </div>

      <ResponsiveContainer width="100%" height={260}>
        <ComposedChart data={chartData} margin={{ top: 8, right: 8, left: 0, bottom: 0 }}>
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
                payload={payload?.map((p) => ({
                  name: p.dataKey === "avg" ? `${ROLLING_WEEKS}-wk avg` : "Volume",
                  value: p.value as number,
                  color: p.dataKey === "avg" ? chartColors.inkSecondary : chartColors.accent,
                }))}
                formatValue={(v) => `${v}km`}
              />
            )}
          />
          <Bar dataKey="km" fill={chartColors.accent} radius={[4, 4, 0, 0]} maxBarSize={22} fillOpacity={0.85} />
          <Line
            type="monotone"
            dataKey="avg"
            stroke={chartColors.inkSecondary}
            strokeWidth={2}
            dot={false}
            activeDot={{ r: 4 }}
          />
        </ComposedChart>
      </ResponsiveContainer>
    </div>
  );
}
