// Structured-output schema + rendering for strength workouts. The zod schema
// pins every exercise the LLM can select to the full Garmin exercise name
// reference table (src/lib/coaching/exerciseCatalog.ts) via an enum of exact
// Garmin Connect display strings, so whatever it suggests is typeable verbatim
// into Garmin Connect's manual exercise picker (this is a naming-match aid,
// not an API push — Edu hand-enters each session himself). The enum is a
// strong instruction rather than a hard stop: the tool call can't be sent with
// `strict: true` at this catalog size (see generateStructured for the measured
// reason), so an off-catalog name is caught on the way in by the re-parse and
// lookup below rather than being impossible to emit.
// The formatter then turns the validated, catalog-backed
// structure into the same free-text template the rest of the app
// (StrengthSessionDetail's legacy fallback, weekly email, etc.) already
// knows how to render, so nothing downstream breaks.
import { z } from "zod";
import type { ExerciseCatalog, GarminExercise } from "./exerciseCatalog";
import type { StrengthExerciseJson, StrengthSectionJson, StrengthWorkoutJson } from "./plan";
import type { planWorkoutExercises } from "@/lib/db/schema";

const SECTION_LABELS = ["Warm-up", "Circuit", "Core finisher", "Cool-down"] as const;

const SECTION_ENUM_BY_LABEL: Record<(typeof SECTION_LABELS)[number], "warm_up" | "circuit" | "core_finisher" | "cool_down"> = {
  "Warm-up": "warm_up",
  Circuit: "circuit",
  "Core finisher": "core_finisher",
  "Cool-down": "cool_down",
};

export function buildStrengthWorkoutSchema(exerciseNames: string[]) {
  const exerciseSchema = z.object({
    exerciseName: z
      .enum(exerciseNames)
      .describe(
        "The exact Garmin Connect exercise name from the reference list below — verbatim, never invented, and never a combination of two list entries. Commit to one specific exercise per step (e.g. \"Knee Push-up\", not \"Push-up (knee or full)\") — if you want an easier or harder variant, pick that variant's own list entry instead of describing a choice."
      ),
    sets: z.number().int().min(1).max(6).optional().describe("1-6 sets. Omit for an exercise repeated once per circuit round."),
    reps: z
      .string()
      .min(1)
      .describe('Count- or time-based rep scheme for one set, e.g. "12-15", "8 each side", "45-60s".'),
    restBetweenSetsSeconds: z
      .number()
      .int()
      .min(0)
      .max(300)
      .optional()
      .describe("Seconds, 0-300. Rest after this exercise before its next set (omit for a single-set exercise)."),
  });

  const sectionSchema = z.object({
    label: z.enum(SECTION_LABELS),
    rounds: z.string().optional().describe('e.g. "2-3" — only meaningful for a multi-round section like Circuit.'),
    restBetweenRoundsSeconds: z
      .number()
      .int()
      .min(0)
      .max(300)
      .optional()
      .describe(
        "Seconds, 0-300. Rest after completing one full round before starting the next (only for multi-round sections)."
      ),
    exercises: z
      .array(exerciseSchema)
      .min(1)
      .max(8)
      .describe("Between 1 and 8 exercises, in the order the athlete performs them."),
  });

  return z
    .object({
      sections: z
        .array(sectionSchema)
        .min(4)
        .max(4)
        .describe(
          "Exactly four sections — one per label, in this order: Warm-up, Circuit, Core finisher, Cool-down."
        ),
    })
    .refine((val) => val.sections.map((s) => s.label).join("|") === SECTION_LABELS.join("|"), {
      message: `sections must be exactly [${SECTION_LABELS.join(", ")}] in that order, one each`,
      path: ["sections"],
    });
}

export type StrengthWorkoutModelOutput = z.infer<ReturnType<typeof buildStrengthWorkoutSchema>>;

/** Resolves the model's exercise names against the reference table. Throws if
 * the model returned a name outside the table — with strict off this is a real
 * (if unlikely) possibility rather than a theoretical one, and together with
 * the zod re-parse in generateStructured it is the last line of defense before
 * an invented exercise name reaches the database. */
export function resolveStrengthWorkout(output: StrengthWorkoutModelOutput, catalog: ExerciseCatalog): StrengthWorkoutJson {
  return {
    sections: output.sections.map(
      (section): StrengthSectionJson => ({
        label: section.label,
        rounds: section.rounds,
        restBetweenRoundsSeconds: section.restBetweenRoundsSeconds,
        exercises: section.exercises.map((ex): StrengthExerciseJson => {
          catalog.lookup(ex.exerciseName); // throws if not in the table
          return {
            exerciseName: ex.exerciseName,
            sets: ex.sets,
            reps: ex.reps,
            restBetweenSetsSeconds: ex.restBetweenSetsSeconds,
          };
        }),
      })
    ),
  };
}

function formatExerciseLine(ex: StrengthExerciseJson): string {
  const loadPart = ex.sets ? `${ex.sets}x${ex.reps}` : `x ${ex.reps}`;
  const restSuffix = ex.restBetweenSetsSeconds ? ` (${ex.restBetweenSetsSeconds}s rest)` : "";
  return `${ex.exerciseName} ${loadPart}${restSuffix}`;
}

function formatSectionMeta(section: StrengthSectionJson): string {
  const parts: string[] = [];
  if (section.rounds) parts.push(`${section.rounds} rounds`);
  if (section.restBetweenRoundsSeconds) parts.push(`${section.restBetweenRoundsSeconds}s rest between rounds`);
  return parts.join(", ");
}

/** Renders the structured, catalog-backed workout into the same
 * "Warm-up: ...\nCircuit (meta):\n  - Exercise x reps\n..." template the
 * generator used to write as free text — src/lib/strengthParser.ts and
 * StrengthSessionDetail keep working unmodified against this output. */
export function formatStrengthWorkoutText(strength: StrengthWorkoutJson): { description: string; humanReadable: string } {
  const lines: string[] = [];
  for (const section of strength.sections) {
    const meta = formatSectionMeta(section);
    const metaSuffix = meta ? ` (${meta})` : "";

    if (section.label === "Warm-up" || section.label === "Cool-down") {
      const prose = section.exercises.map((ex) => `${ex.exerciseName} (${ex.reps})`).join(", ");
      lines.push(`${section.label}${metaSuffix}: ${prose}`);
    } else {
      lines.push(`${section.label}${metaSuffix}:`);
      for (const ex of section.exercises) {
        lines.push(`  - ${formatExerciseLine(ex)}`);
      }
    }
  }
  const humanReadable = lines.join("\n");

  const circuit = strength.sections.find((s) => s.label === "Circuit");
  const exerciseCount = circuit?.exercises.length ?? 0;
  const roundsPart = circuit?.rounds ? `${circuit.rounds} rounds` : "circuit";
  const description = `Warm-up, ${roundsPart} of ${exerciseCount} exercises, core finisher, cool-down.`;

  return { description, humanReadable };
}

type PlanWorkoutExerciseInsert = typeof planWorkoutExercises.$inferInsert;

/** Walks a resolved strength workout into plan_workout_exercises insert
 * rows for one plan_workout — one row per exercise, with the section's
 * rounds/restBetweenRoundsSeconds duplicated onto each of its exercises
 * (see schema.ts's planWorkoutExercises comment for why). `allExercises`
 * is used to resolve the nullable garminExerciseId FK back to the
 * reference table by exact name — everything else is already denormalized
 * onto the StrengthExerciseJson itself. */
export function flattenStrengthExercises(
  strength: StrengthWorkoutJson,
  planWorkoutId: string,
  allExercises: GarminExercise[]
): PlanWorkoutExerciseInsert[] {
  const idByName = new Map(allExercises.map((e) => [e.name, e.id]));

  const rows: PlanWorkoutExerciseInsert[] = [];
  for (const section of strength.sections) {
    section.exercises.forEach((ex, orderIndex) => {
      rows.push({
        planWorkoutId,
        section: SECTION_ENUM_BY_LABEL[section.label],
        orderIndex,
        garminExerciseId: idByName.get(ex.exerciseName) ?? null,
        exerciseName: ex.exerciseName,
        sets: ex.sets ?? null,
        reps: ex.reps,
        restBetweenSetsSeconds: ex.restBetweenSetsSeconds ?? null,
        rounds: section.rounds ?? null,
        restBetweenRoundsSeconds: section.restBetweenRoundsSeconds ?? null,
      });
    });
  }
  return rows;
}
