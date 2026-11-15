"use server";

import { revalidatePath } from "next/cache";
import { redirect } from "next/navigation";
import { getEnv } from "@/lib/env";
import { getHoldState, setHold } from "@/lib/pause";
import { startFreshBlock } from "@/lib/coaching/freshBlock";
import { parseAvoidList, type TrainingSetting } from "@/lib/coaching/setting";
import { syncRecentActivities } from "@/lib/sync/activities";
import {
  createPushSubscription,
  deletePushSubscription,
  listPushSubscriptions,
} from "@/lib/strava/client";

function assertToken(formData: FormData): string {
  const token = formData.get("token");
  if (typeof token !== "string" || token !== getEnv().INTERNAL_API_TOKEN) {
    throw new Error("Unauthorized");
  }
  return token;
}

/**
 * Brings the Strava push subscription in line with the hold. Left live through
 * a hold, every gym session still arrives and gets written; left deleted after
 * a resume, runs only trickle in on the hourly poll instead of landing within
 * seconds.
 *
 * Non-fatal: the hold itself is what stops the writes, and the settings page
 * reads the real subscription list on every render — so a failure here
 * surfaces as a visible mismatch rather than a silent one.
 */
async function alignPushSubscription(paused: boolean): Promise<void> {
  try {
    const existing = await listPushSubscriptions();
    if (paused) {
      for (const sub of existing) await deletePushSubscription(sub.id);
    } else if (existing.length === 0) {
      await createPushSubscription(`${getEnv().APP_BASE_URL}/api/webhooks/strava`);
    }
  } catch (err) {
    console.error("Failed to bring the Strava push subscription in line with the hold", err);
  }
}

/**
 * Flip the coaching hold from /settings.
 *
 * A Server Action is a POST endpoint in its own right — reachable by anyone
 * who knows its id, whether or not they could render the page that calls it.
 * Since this app has no user auth, the token is re-checked HERE rather than
 * trusted from the page that submitted the form.
 */
export async function setHoldAction(formData: FormData): Promise<void> {
  assertToken(formData);

  const paused = formData.get("intent") === "hold";
  const rawNote = formData.get("note");
  const note = typeof rawNote === "string" && rawNote.trim().length > 0 ? rawNote.trim() : null;

  await setHold(paused, note);
  await alignPushSubscription(paused);

  revalidatePath("/settings");
  revalidatePath("/");
}

function settingFromForm(formData: FormData): TrainingSetting {
  const avoid = formData.get("avoid");
  return {
    running: formData.get("running") === "outdoor" ? "outdoor" : "treadmill",
    strength: formData.get("strength") === "bodyweight" ? "bodyweight" : "gym",
    avoidExercises: parseAvoidList(typeof avoid === "string" ? avoid : ""),
    explainExercises: formData.get("explain") === "on",
  };
}

/**
 * The whole way back, in one click: lift the hold if there is one, read
 * everything Strava has from the gap, and write week 1 of a new block from it.
 *
 * Ordered so that each failure leaves something sensible behind. The hold
 * comes off first because the sync is a write and the hold covers writes. If
 * Strava can't be read, no plan is built — a plan sized from history that
 * stops at the day the hold began would call months of gym work "no training".
 * If the plan can't be built, coaching is still resumed and synced, and the
 * same form is one click from trying again.
 */
export async function startFreshBlockAction(formData: FormData): Promise<void> {
  const token = assertToken(formData);
  const settingsUrl = (outcome: string) => `/settings?token=${encodeURIComponent(token)}&block=${outcome}`;
  const setting = settingFromForm(formData);

  const hold = await getHoldState();
  if (hold.envOverride) redirect(settingsUrl("env-hold"));

  if (hold.paused) {
    await setHold(false);
    await alignPushSubscription(false);
  }

  try {
    // The sync cursor is the start of the last activity synced before the hold,
    // so this one call reads the whole gap however long it was — no separate
    // backfill needed.
    await syncRecentActivities();
  } catch (err) {
    console.error("Fresh block: reading Strava failed — no plan built", err);
    revalidatePath("/");
    redirect(settingsUrl("sync-failed"));
  }

  try {
    const result = await startFreshBlock({ todayStr: new Date().toISOString().slice(0, 10), setting });
    console.log(
      `Fresh block: plan version ${result.version} (${result.planId}), week 1 from ${result.weekStartDate}, starting point "${result.guardrails.startingPoint}".`
    );
    if (result.warnings.length > 0) console.log("Fresh block warnings:", result.warnings);
  } catch (err) {
    console.error("Fresh block: building the plan failed", err);
    revalidatePath("/");
    redirect(settingsUrl("build-failed"));
  }

  revalidatePath("/settings");
  revalidatePath("/");
  redirect("/");
}
