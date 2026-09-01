import { desc, eq } from "drizzle-orm";
import { db } from "@/lib/db/client";
import { zoneVersions } from "@/lib/db/schema";
import { sampleDeltaSeconds } from "@/lib/metrics/ngp";

export interface HrZoneDef {
  zone: number;
  name: string;
  hrLow: number;
  hrHigh: number | null;
}

export async function getCurrentHrZones(): Promise<HrZoneDef[]> {
  const [row] = await db
    .select({ hrZones: zoneVersions.hrZones })
    .from(zoneVersions)
    .where(eq(zoneVersions.isCurrent, true))
    .orderBy(desc(zoneVersions.asOfDate))
    .limit(1);
  if (!row) {
    throw new Error("No current zone_versions row found — run the seed script first.");
  }
  return row.hrZones as HrZoneDef[];
}

export interface PaceZoneDef {
  zone: number;
  name: string;
  paceMinPerKm: string;
}

export interface CurrentZoneVersion {
  asOfDate: string;
  source: string;
  hrZones: HrZoneDef[];
  paceZones: PaceZoneDef[];
}

/**
 * The live zone version, HR and pace together. The plan generator reads this rather
 * than the copy frozen inside plan_json — once a VDOT lands, the Daniels paces replace
 * the seeded Strava ones, and a plan prescribed against the old table would be handing
 * out paces the athlete's own fitness estimate has already moved past.
 */
export async function getCurrentZoneVersion(): Promise<CurrentZoneVersion | null> {
  const [row] = await db
    .select()
    .from(zoneVersions)
    .where(eq(zoneVersions.isCurrent, true))
    .orderBy(desc(zoneVersions.asOfDate))
    .limit(1);
  if (!row) return null;
  return {
    asOfDate: row.asOfDate,
    source: row.source,
    hrZones: row.hrZones as HrZoneDef[],
    paceZones: row.paceZones as PaceZoneDef[],
  };
}

export function bucketizeHrZone(hr: number, zones: HrZoneDef[]): number {
  const sorted = [...zones].sort((a, b) => a.zone - b.zone);
  for (const z of sorted) {
    if (hr >= z.hrLow && (z.hrHigh == null || hr <= z.hrHigh)) return z.zone;
  }
  return sorted[sorted.length - 1]?.zone ?? 0;
}

export interface ZoneTimeBucket {
  zone: number;
  name: string;
  seconds: number;
  percent: number;
}

/** Time-weighted % of the activity spent in each HR zone. */
export function computeZoneTimeDistribution(
  heartRate: number[],
  time: number[],
  zones: HrZoneDef[]
): ZoneTimeBucket[] {
  const totals = new Map<number, number>();
  let totalSeconds = 0;
  const n = Math.min(heartRate.length, time.length);
  for (let i = 0; i < n - 1; i++) {
    const dt = sampleDeltaSeconds(time, i);
    const zone = bucketizeHrZone(heartRate[i], zones);
    totals.set(zone, (totals.get(zone) ?? 0) + dt);
    totalSeconds += dt;
  }
  return [...zones]
    .sort((a, b) => a.zone - b.zone)
    .map((z) => {
      const seconds = totals.get(z.zone) ?? 0;
      return {
        zone: z.zone,
        name: z.name,
        seconds,
        percent: totalSeconds > 0 ? (seconds / totalSeconds) * 100 : 0,
      };
    });
}

/** Parses "Zone 1-2 (HR <156bpm)" / "Zone 3" style prescription text into a numeric range. */
export function parseZoneRange(text: string | null | undefined): { min: number; max: number } | null {
  if (!text) return null;
  const match = text.match(/Zone\s*(\d)(?:\s*-\s*(\d))?/i);
  if (!match) return null;
  const min = Number(match[1]);
  const max = match[2] ? Number(match[2]) : min;
  return { min, max };
}

// % of time above the prescribed zone ceiling before calling a session
// "drifted" rather than normal HR variation — tuned against the known Jun 30
// 2026 test case (78.5% Zone 3 on a prescribed Zone 1-2 easy run).
const DRIFT_THRESHOLD_PERCENT = 20;

export interface ZoneAdherenceAssessment {
  targetZoneRange: { min: number; max: number } | null;
  distribution: ZoneTimeBucket[];
  percentAboveTarget: number;
  adherence: "ok" | "drifted" | "na";
}

export function assessZoneAdherence(
  distribution: ZoneTimeBucket[],
  targetZoneText: string | null | undefined
): ZoneAdherenceAssessment {
  const targetZoneRange = parseZoneRange(targetZoneText);
  if (!targetZoneRange) {
    return { targetZoneRange: null, distribution, percentAboveTarget: 0, adherence: "na" };
  }
  const percentAboveTarget = distribution
    .filter((d) => d.zone > targetZoneRange.max)
    .reduce((sum, d) => sum + d.percent, 0);
  const adherence = percentAboveTarget > DRIFT_THRESHOLD_PERCENT ? "drifted" : "ok";
  return { targetZoneRange, distribution, percentAboveTarget, adherence };
}
