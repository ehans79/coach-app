"use server";

import { revalidatePath } from "next/cache";
import { getEnv } from "@/lib/env";
import { setHold } from "@/lib/pause";
import {
  createPushSubscription,
  deletePushSubscription,
  listPushSubscriptions,
} from "@/lib/strava/client";

/**
 * Flip the coaching hold from /settings.
 *
 * A Server Action is a POST endpoint in its own right — reachable by anyone
 * who knows its id, whether or not they could render the page that calls it.
 * Since this app has no user auth, the token is re-checked HERE rather than
 * trusted from the page that submitted the form.
 */
export async function setHoldAction(formData: FormData): Promise<void> {
  const env = getEnv();

  const token = formData.get("token");
  if (typeof token !== "string" || token !== env.INTERNAL_API_TOKEN) {
    throw new Error("Unauthorized");
  }

  const paused = formData.get("intent") === "hold";
  const rawNote = formData.get("note");
  const note = typeof rawNote === "string" && rawNote.trim().length > 0 ? rawNote.trim() : null;

  await setHold(paused, note);

  // The Strava push subscription follows the hold in the same click. Left live
  // through a hold, every gym session still arrives and gets written; left
  // deleted after a resume, runs only trickle in on the hourly poll instead of
  // landing within seconds.
  try {
    const existing = await listPushSubscriptions();
    if (paused) {
      for (const sub of existing) await deletePushSubscription(sub.id);
    } else if (existing.length === 0) {
      await createPushSubscription(`${env.APP_BASE_URL}/api/webhooks/strava`);
    }
  } catch (err) {
    // Non-fatal: the hold itself is what stops the writes, and the settings
    // page reads the real subscription list on every render — so a failure
    // here surfaces as a visible mismatch rather than a silent one.
    console.error("Failed to bring the Strava push subscription in line with the hold", err);
  }

  revalidatePath("/settings");
  revalidatePath("/");
}
