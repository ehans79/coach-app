import { eq } from "drizzle-orm";
import { db } from "@/lib/db/client";
import { activities, activityMetrics, dailyLoad } from "@/lib/db/schema";
import { localDateOf } from "@/lib/coaching/matching";

const LAMBDA_CTL = 2 / 43; // 42-day EWMA
const LAMBDA_ATL = 2 / 8; // 7-day EWMA
const ACUTE_WINDOW_DAYS = 7;
const CHRONIC_WINDOW_DAYS = 21; // preceding, DISJOINT from the acute window — the
// "uncoupled" ACWR fix (Lolli et al. 2019) rather than the naive coupled 7/28
// rolling-average ratio, per the reference doc.

function addDays(dateStr: string, days: number): string {
  const d = new Date(`${dateStr}T00:00:00Z`);
  d.setUTCDate(d.getUTCDate() + days);
  return d.toISOString().slice(0, 10);
}

/**
 * Pure aggregation over already-computed activity_metrics — no Strava/LLM calls —
 * so it's cheap enough to fully recompute and re-upsert the entire date range on
 * every call, self-healing after any backfill or athlete_constants change. Called
 * from the hourly /api/internal/sync route and once more in cron-weekly.ts.
 */
export async function computeDailyRollup(): Promise<{ daysComputed: number }> {
  const rows = await db
    .select({
      startDateLocal: activities.startDateLocal,
      primaryTss: activityMetrics.primaryTss,
      zoneSecondsLow: activityMetrics.zoneSecondsLow,
      zoneSecondsModerate: activityMetrics.zoneSecondsModerate,
      zoneSecondsHigh: activityMetrics.zoneSecondsHigh,
    })
    .from(activityMetrics)
    .innerJoin(activities, eq(activityMetrics.activityId, activities.id))
    .where(eq(activities.sportType, "Run"));

  if (rows.length === 0) return { daysComputed: 0 };

  const byDate = new Map<
    string,
    { totalTss: number; runCount: number; low: number; moderate: number; high: number }
  >();
  for (const r of rows) {
    const date = localDateOf(r.startDateLocal);
    const entry = byDate.get(date) ?? { totalTss: 0, runCount: 0, low: 0, moderate: 0, high: 0 };
    entry.totalTss += r.primaryTss ?? 0;
    entry.runCount += 1;
    entry.low += r.zoneSecondsLow ?? 0;
    entry.moderate += r.zoneSecondsModerate ?? 0;
    entry.high += r.zoneSecondsHigh ?? 0;
    byDate.set(date, entry);
  }

  const sortedDates = [...byDate.keys()].sort();
  const firstDate = sortedDates[0];
  const todayStr = new Date().toISOString().slice(0, 10);
  const lastDate = todayStr > sortedDates[sortedDates.length - 1] ? todayStr : sortedDates[sortedDates.length - 1];

  const days: string[] = [];
  for (let d = firstDate; d <= lastDate; d = addDays(d, 1)) days.push(d);
  const totalTssByDay = days.map((d) => byDate.get(d)?.totalTss ?? 0);

  let ctlPrev = 0;
  let atlPrev = 0;
  const results: (typeof dailyLoad.$inferInsert)[] = [];

  for (let i = 0; i < days.length; i++) {
    const date = days[i];
    const entry = byDate.get(date);
    const totalTss = totalTssByDay[i];

    // TSB reflects the state ENTERING today — yesterday's CTL minus yesterday's ATL,
    // computed before today's session updates ctl/atl below.
    const tsb = ctlPrev - atlPrev;
    const ctl = totalTss * LAMBDA_CTL + ctlPrev * (1 - LAMBDA_CTL);
    const atl = totalTss * LAMBDA_ATL + atlPrev * (1 - LAMBDA_ATL);

    let acuteAvgLoad7d: number | null = null;
    let chronicAvgLoad21d: number | null = null;
    let acwr: number | null = null;
    if (i >= ACUTE_WINDOW_DAYS + CHRONIC_WINDOW_DAYS - 1) {
      const acuteSlice = totalTssByDay.slice(i - ACUTE_WINDOW_DAYS + 1, i + 1);
      const chronicSlice = totalTssByDay.slice(
        i - ACUTE_WINDOW_DAYS - CHRONIC_WINDOW_DAYS + 1,
        i - ACUTE_WINDOW_DAYS + 1
      );
      acuteAvgLoad7d = acuteSlice.reduce((a, b) => a + b, 0) / acuteSlice.length;
      chronicAvgLoad21d = chronicSlice.reduce((a, b) => a + b, 0) / chronicSlice.length;
      acwr = chronicAvgLoad21d > 0 ? acuteAvgLoad7d / chronicAvgLoad21d : null;
    }

    results.push({
      date,
      totalTss,
      runCount: entry?.runCount ?? 0,
      ctl,
      atl,
      tsb,
      acuteAvgLoad7d,
      chronicAvgLoad21d,
      acwr,
      zoneSecondsLow: entry?.low ?? 0,
      zoneSecondsModerate: entry?.moderate ?? 0,
      zoneSecondsHigh: entry?.high ?? 0,
      computedAt: new Date(),
    });

    // Cold-started at 0 on day 1 (standard Coggan convention) — a non-issue for
    // "today"'s numbers once the backfill covers well over 42 days of history,
    // though the earliest backfilled days will read artificially low CTL.
    ctlPrev = ctl;
    atlPrev = atl;
  }

  await db.transaction(async (tx) => {
    for (const row of results) {
      await tx.insert(dailyLoad).values(row).onConflictDoUpdate({ target: dailyLoad.date, set: row });
    }
  });

  return { daysComputed: results.length };
}
