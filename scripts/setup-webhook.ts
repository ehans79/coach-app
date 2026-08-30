import { config } from "dotenv";
config({ path: ".env.local", quiet: true });
config({ quiet: true }); // fall back to .env for anything not in .env.local
import { createPushSubscription, listPushSubscriptions } from "../src/lib/strava/client";
import { getEnv } from "../src/lib/env";

/**
 * One-time setup: registers this app's webhook callback with Strava.
 * APP_BASE_URL must be a real, publicly reachable HTTPS URL for Strava's
 * GET handshake to succeed — this only works once deployed (or tunneled).
 */
async function main() {
  const existing = await listPushSubscriptions();
  if (existing.length > 0) {
    console.log("Push subscription(s) already exist — nothing to do:");
    console.log(existing);
    process.exit(0);
  }

  const env = getEnv();
  const callbackUrl = `${env.APP_BASE_URL}/api/webhooks/strava`;
  console.log(`Creating Strava push subscription -> ${callbackUrl}`);
  const result = await createPushSubscription(callbackUrl);
  console.log("Created subscription:", result);
  process.exit(0);
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
