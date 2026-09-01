"use client";

import {
  ComposedChart,
  Line,
  Scatter,
  XAxis,
  YAxis,
  CartesianGrid,
  Tooltip,
  ResponsiveContainer,
} from "recharts";
import { chartColors } from "@/lib/chartColors";
import { formatDuration } from "@/lib/format";
import type { VdotHistoryPoint } from "@/lib/metrics/qualifyingEfforts";

function dateLabel(dateStr: string): string {
  return new Date(`${dateStr}T00:00:00Z`).toLocaleDateString("en-GB", { month: "short", day: "numeric" });
}

/**
 * VDOT per qualifying effort over time. Every point is one detected race or time trial —
 * there is nothing to interpolate between them, so the connecting line is drawn thin and
 * the markers carry the emphasis: with only a handful of efforts, a confident-looking
 * trend line would overstate what the data supports.
 */
export function VdotTrendChart({ data }: { data: VdotHistoryPoint[] }) {
  const chartData = data.map((d) => ({
    date: dateLabel(d.effortDate),
    vdot: d.vdot,
    name: d.activityName,
    distanceKm: d.distanceKm,
    durationSeconds: d.durationSeconds,
    source: d.source,
  }));

  const values = data.map((d) => d.vdot);
  const min = Math.min(...values);
  const max = Math.max(...values);
  // A flat-ish series shouldn't render as dramatic noise across the full axis height.
  const pad = Math.max(1, (max - min) * 0.35);

  return (
    <ResponsiveContainer width="100%" height={200}>
      <ComposedChart data={chartData} margin={{ top: 8, right: 8, left: 0, bottom: 0 }}>
        <CartesianGrid vertical={false} stroke={chartColors.gridline} strokeDasharray="0" />
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
          width={34}
          domain={[Math.floor(min - pad), Math.ceil(max + pad)]}
        />
        <Tooltip
          content={({ active, payload }) => {
            if (!active || !payload || payload.length === 0) return null;
            const point = payload[0].payload as (typeof chartData)[number];
            return (
              <div className="rounded-lg border border-border bg-surface px-3 py-2 text-xs shadow-sm">
                <div className="font-medium text-ink-primary">VDOT {point.vdot.toFixed(1)}</div>
                <div className="mt-0.5 text-ink-secondary">{point.name}</div>
                <div className="text-ink-muted">
                  {point.date} · {point.distanceKm.toFixed(2)}km in {formatDuration(point.durationSeconds)}
                </div>
                <div className="text-ink-muted">
                  {point.source === "strava_race" ? "Tagged as a race in Strava" : "Detected time-trial effort"}
                </div>
              </div>
            );
          }}
        />
        <Line
          type="linear"
          dataKey="vdot"
          stroke={chartColors.accent}
          strokeWidth={1.5}
          strokeOpacity={0.45}
          dot={false}
          activeDot={false}
          isAnimationActive={false}
          legendType="none"
        />
        <Scatter dataKey="vdot" fill={chartColors.accent} isAnimationActive={false} />
      </ComposedChart>
    </ResponsiveContainer>
  );
}
