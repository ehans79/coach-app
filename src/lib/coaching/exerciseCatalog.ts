// Reads the Garmin exercise name reference table (garmin_exercises, see
// src/lib/db/schema.ts + scripts/import-garmin-exercises.ts) and turns it
// into the pieces the strength-plan generator needs: the full list of exact
// Garmin Connect display strings, used to build a JSON-schema enum so the
// LLM's structured-output tool call can only select a name that actually
// exists in the table — guaranteeing it's typeable verbatim into Garmin
// Connect's manual exercise picker. No curation/filtering: every imported
// name is available to the generator.
import { asc } from "drizzle-orm";
import { db } from "@/lib/db/client";
import { garminExercises } from "@/lib/db/schema";

export interface GarminExercise {
  id: string;
  name: string;
}

export async function getAllExercises(): Promise<GarminExercise[]> {
  const rows = await db
    .select({ id: garminExercises.id, name: garminExercises.name })
    .from(garminExercises)
    .orderBy(asc(garminExercises.name));

  if (rows.length === 0) {
    throw new Error(
      "No Garmin exercises found — run `npm run db:import-exercises` before generating a strength plan."
    );
  }
  return rows;
}

export class ExerciseCatalog {
  readonly exercises: GarminExercise[];
  readonly names: string[];
  private readonly byName: Map<string, GarminExercise>;

  constructor(exercises: GarminExercise[]) {
    this.exercises = exercises;
    this.names = exercises.map((e) => e.name);
    this.byName = new Map(exercises.map((e) => [e.name, e]));
  }

  lookup(name: string): GarminExercise {
    const found = this.byName.get(name);
    if (!found) {
      throw new Error(`Model returned a Garmin exercise name not in the reference table: "${name}"`);
    }
    return found;
  }

  /** For the system prompt — the full list, exact strings, comma-separated
   * (cheaper in tokens than a JSON array) so the model sees the real menu. */
  describe(): string {
    return this.names.join(", ");
  }
}
