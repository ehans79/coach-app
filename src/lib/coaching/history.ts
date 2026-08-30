import { and, desc, eq, isNotNull, ne } from "drizzle-orm";
import { db } from "@/lib/db/client";
import { activities } from "@/lib/db/schema";

/**
 * Athlete's own recent average cadence across the last N runs (excluding the
 * activity being assessed) — the brief wants cadence flagged relative to
 * Edu's own baseline, not a generic universal target.
 */
export async function getRollingAverageCadence(
  excludeActivityId: number,
  lookback = 10
): Promise<number | null> {
  const rows = await db
    .select({ cadence: activities.averageCadence })
    .from(activities)
    .where(
      and(
        eq(activities.sportType, "Run"),
        isNotNull(activities.averageCadence),
        ne(activities.id, excludeActivityId)
      )
    )
    .orderBy(desc(activities.startDate))
    .limit(lookback);

  const vals = rows.map((r) => r.cadence).filter((v): v is number => v != null);
  if (vals.length === 0) return null;
  return vals.reduce((a, b) => a + b, 0) / vals.length;
}
