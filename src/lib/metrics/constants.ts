import { desc, eq } from "drizzle-orm";
import { db } from "@/lib/db/client";
import { athleteConstants } from "@/lib/db/schema";

export interface AthleteConstants {
  id: string;
  hrMax: number;
  restingHr: number;
  thresholdHr: number;
  thresholdPaceSecPerKm: number;
  vdot: number | null;
  isProvisional: boolean;
  asOfDate: string;
}

export async function getCurrentAthleteConstants(): Promise<AthleteConstants> {
  const [row] = await db
    .select()
    .from(athleteConstants)
    .where(eq(athleteConstants.isCurrent, true))
    .orderBy(desc(athleteConstants.asOfDate))
    .limit(1);
  if (!row) {
    throw new Error("No current athlete_constants row found — run the seed script first.");
  }
  return {
    id: row.id,
    hrMax: row.hrMax,
    restingHr: row.restingHr,
    thresholdHr: row.thresholdHr,
    thresholdPaceSecPerKm: row.thresholdPaceSecPerKm,
    vdot: row.vdot,
    isProvisional: row.isProvisional,
    asOfDate: row.asOfDate,
  };
}
