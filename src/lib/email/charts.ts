// Email clients strip <script> and most CSS-based charts, so the weekly
// debrief embeds a static chart image rendered server-side via QuickChart's
// hosted Chart.js renderer (no headless-browser dependency to run ourselves).
import { theme } from "@/lib/theme";

const ZONE_COLORS = [...theme.zones]; // Zone 1 -> 5, same ordinal ramp as the dashboard

export function buildZoneChartUrl(zonePercents: [number, number, number, number, number]): string {
  const config = {
    type: "bar",
    data: {
      labels: ["Zone 1", "Zone 2", "Zone 3", "Zone 4", "Zone 5"],
      datasets: [{ data: zonePercents, backgroundColor: ZONE_COLORS }],
    },
    options: {
      plugins: {
        legend: { display: false },
        title: { display: true, text: "% of weekly running time in each HR zone" },
      },
      scales: { y: { beginAtZero: true } },
    },
  };

  const url = new URL("https://quickchart.io/chart");
  url.searchParams.set("c", JSON.stringify(config));
  url.searchParams.set("width", "500");
  url.searchParams.set("height", "260");
  url.searchParams.set("backgroundColor", "white");
  url.searchParams.set("format", "png");
  return url.toString();
}

export interface LoadChartPoint {
  date: string; // YYYY-MM-DD
  ctl: number;
  atl: number;
  tsb: number;
}

/** CTL/ATL/TSB "Performance Management" trend for the weekly debrief — same idea as the dashboard's CtlAtlTsbChart, rendered statically. */
export function buildLoadChartUrl(points: LoadChartPoint[]): string {
  const labels = points.map((p) => new Date(`${p.date}T00:00:00Z`).toLocaleDateString("en-GB", { month: "short", day: "numeric" }));
  const config = {
    type: "line",
    data: {
      labels,
      datasets: [
        { label: "CTL (fitness)", data: points.map((p) => p.ctl), borderColor: theme.accent, backgroundColor: theme.accent, fill: false, pointRadius: 0, borderWidth: 2 },
        { label: "ATL (fatigue)", data: points.map((p) => p.atl), borderColor: theme.inkSecondary, backgroundColor: theme.inkSecondary, fill: false, pointRadius: 0, borderWidth: 2 },
        { label: "TSB (form)", data: points.map((p) => p.tsb), borderColor: theme.statusGood, backgroundColor: theme.statusGood, fill: false, pointRadius: 0, borderWidth: 2 },
      ],
    },
    options: {
      plugins: { legend: { display: true, position: "bottom" }, title: { display: true, text: "Training load — fitness / fatigue / form" } },
      scales: { x: { ticks: { maxTicksLimit: 8 } } },
    },
  };

  const url = new URL("https://quickchart.io/chart");
  url.searchParams.set("c", JSON.stringify(config));
  url.searchParams.set("width", "500");
  url.searchParams.set("height", "260");
  url.searchParams.set("backgroundColor", "white");
  url.searchParams.set("format", "png");
  return url.toString();
}
