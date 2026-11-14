import { eq } from "drizzle-orm";
import { db } from "@/lib/db/client";
import { appSettings } from "@/lib/db/schema";

/**
 * The coaching hold — the off-season switch. While held, every write path in
 * the app is a no-op: the Strava webhook acks and discards, the hourly
 * fallback poll syncs nothing, and the Sunday job neither regenerates the plan
 * nor emails the debrief. Reading the dashboard is unaffected; the history
 * stays browsable, it just stops growing.
 *
 * Two layers, deliberately:
 *
 * - The `app_settings` row, flipped from /settings. This is the everyday
 *   switch — no redeploy, one source of truth for all three write paths, and
 *   it can't drift out of sync the way a per-service env var does.
 * - `COACH_PAUSED` in the environment, which forces the hold on and CANNOT be
 *   lifted from the UI. That asymmetry is the point: the app has no user auth,
 *   so the env var is the one hold that survives someone reaching the public
 *   URL. Deploy-level stop; the row is the day-to-day one.
 *
 * Reads fail closed. If the settings row can't be read the app treats itself
 * as held, on the grounds that a database it can't query is not one it should
 * be writing coaching decisions into.
 */

const SETTINGS_ROW_ID = "singleton";

export interface HoldState {
  /** True when nothing should write — whatever the reason. */
  paused: boolean;
  /** Which layer is holding it, or null when actively coaching. */
  source: "env" | "database" | null;
  /** When the hold started — the backfill start date on the way back. */
  since: Date | null;
  note: string | null;
  /**
   * True when COACH_PAUSED is set on the server. Surfaced so /settings can say
   * that the toggle alone won't lift the hold, rather than appearing to work
   * and changing nothing.
   */
  envOverride: boolean;
}

/** Read straight off process.env so a hold never depends on the rest of the env being valid. */
export function isHeldByEnv(): boolean {
  const raw = process.env.COACH_PAUSED?.trim().toLowerCase();
  return raw === "true" || raw === "1" || raw === "yes";
}

export async function getHoldState(): Promise<HoldState> {
  const envOverride = isHeldByEnv();

  let row: typeof appSettings.$inferSelect | undefined;
  try {
    [row] = await db.select().from(appSettings).where(eq(appSettings.id, SETTINGS_ROW_ID)).limit(1);
  } catch (err) {
    console.error("Failed to read the coaching hold — treating the app as held", err);
    return {
      paused: true,
      source: envOverride ? "env" : "database",
      since: null,
      note: "Hold state could not be read from the database.",
      envOverride,
    };
  }

  const since = row?.pausedAt ?? null;
  const note = row?.pausedNote ?? null;

  if (envOverride) return { paused: true, source: "env", since, note, envOverride };
  return { paused: since !== null, source: since !== null ? "database" : null, since, note, envOverride };
}

export async function isPaused(): Promise<boolean> {
  return (await getHoldState()).paused;
}

/**
 * Flip the hold. Lifting it clears the timestamp rather than recording a
 * resume date — "paused since" only has to survive until the hold is over, and
 * the plan versions either side already date the gap.
 */
export async function setHold(paused: boolean, note?: string | null): Promise<HoldState> {
  const now = new Date();
  await db
    .insert(appSettings)
    .values({
      id: SETTINGS_ROW_ID,
      pausedAt: paused ? now : null,
      pausedNote: paused ? (note ?? null) : null,
      updatedAt: now,
    })
    .onConflictDoUpdate({
      target: appSettings.id,
      set: { pausedAt: paused ? now : null, pausedNote: paused ? (note ?? null) : null, updatedAt: now },
    });

  return getHoldState();
}

/** Whole days since the hold began — what the resume path needs to backfill. */
export function daysSince(since: Date, now: Date = new Date()): number {
  return Math.max(0, Math.floor((now.getTime() - since.getTime()) / 86_400_000));
}
