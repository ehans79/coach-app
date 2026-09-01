import { config } from "dotenv";
config({ path: ".env.local", quiet: true });
config({ quiet: true }); // fall back to .env for anything not in .env.local

import { readFileSync } from "node:fs";
import { join } from "node:path";
import { sql } from "drizzle-orm";
import { db } from "../src/lib/db/client";
import { garminExercises } from "../src/lib/db/schema";

// Source data: data/garmin-connect-exercises.json — a flat list of exercise
// names exactly as they appear in Garmin Connect's manual strength-workout
// exercise picker, community-compiled directly from that UI on the Garmin
// Forums (see that file's `source`/`note` fields for exact provenance).
// Imported as-is, no filtering: this is a naming-match reference, not a
// curated rotation. Re-running this script is safe — it's just an upsert
// by exact name.
interface GarminExercisesFile {
  source: string;
  sourceUrl: string;
  extractedAt: string;
  note: string;
  exerciseNames: string[];
}

async function main() {
  const dataPath = join(__dirname, "..", "data", "garmin-connect-exercises.json");
  const file = JSON.parse(readFileSync(dataPath, "utf-8")) as GarminExercisesFile;

  console.log(`Importing ${file.exerciseNames.length} exercise names from: ${file.source}`);

  const CHUNK_SIZE = 500;
  let inserted = 0;
  for (let i = 0; i < file.exerciseNames.length; i += CHUNK_SIZE) {
    const chunk = file.exerciseNames.slice(i, i + CHUNK_SIZE);
    await db
      .insert(garminExercises)
      .values(chunk.map((name) => ({ name })))
      .onConflictDoNothing({ target: garminExercises.name });
    inserted += chunk.length;
    console.log(`  upserted ${inserted}/${file.exerciseNames.length}`);
  }

  const [{ count: totalCount }] = await db.select({ count: sql<string>`count(*)` }).from(garminExercises);
  console.log(`Done. ${totalCount} exercise names available to the plan generator.`);
}

main()
  .then(() => process.exit(0))
  .catch((err) => {
    console.error(err);
    process.exit(1);
  });
