// Where the training happens, and what the athlete has asked never to be given.
//
// This lives on the plan document (PlanDocument.setting) rather than in a prompt
// constant because it has to outlive the week it was chosen in: a block is
// started once, from /settings, and then the Sunday job regenerates every later
// week from the plan alone. A treadmill block that quietly turns into "8km
// outdoors" on its second Sunday, or a gym block that re-prescribes the one
// exercise that was ruled out, is the failure this exists to prevent.

export type RunningSetting = "treadmill" | "outdoor";
export type StrengthSetting = "gym" | "bodyweight";

export interface TrainingSetting {
  running: RunningSetting;
  strength: StrengthSetting;
  /**
   * Exercises never to prescribe, matched case-insensitively as a substring of
   * the Garmin exercise name — "Bench Press" rules out all nineteen bench-press
   * entries, not just the plain one. Enforced by removing the matches from the
   * catalog the model chooses from (see ExerciseCatalog.without), so it is a
   * property of the menu rather than a request the model could overlook.
   */
  avoidExercises: string[];
  /** Write a beginner's how-to for every main exercise: setup, movement, starting weight. */
  explainExercises: boolean;
}

/** What every plan written before settings existed was implicitly built for. */
export const LEGACY_SETTING: TrainingSetting = {
  running: "outdoor",
  strength: "bodyweight",
  avoidExercises: [],
  explainExercises: false,
};

/**
 * What the /settings form is pre-filled with when the active plan carries no
 * setting of its own — what Edu asked for coming back from the winter 2026
 * hold: treadmill running, gym strength work explained from scratch, and no
 * bench press.
 */
export const DEFAULT_FRESH_BLOCK_SETTING: TrainingSetting = {
  running: "treadmill",
  strength: "gym",
  avoidExercises: ["Bench Press"],
  explainExercises: true,
};

const MIN_AVOID_TERM_LENGTH = 3;
const MAX_AVOID_TERMS = 12;

/**
 * Parses the comma-separated "never prescribe" field. Terms shorter than three
 * characters are dropped: these are substring matches, and "a" would empty the
 * catalog.
 */
export function parseAvoidList(raw: string): string[] {
  const seen = new Set<string>();
  const terms: string[] = [];
  for (const part of raw.split(/[,\n]/)) {
    const term = part.trim().replace(/\s+/g, " ");
    if (term.length < MIN_AVOID_TERM_LENGTH) continue;
    const key = term.toLowerCase();
    if (seen.has(key)) continue;
    seen.add(key);
    terms.push(term);
  }
  return terms.slice(0, MAX_AVOID_TERMS);
}

export function settingLabel(setting: TrainingSetting): string {
  const run = setting.running === "treadmill" ? "treadmill running" : "outdoor running";
  const strength = setting.strength === "gym" ? "gym strength" : "bodyweight strength";
  return `${run} + ${strength}`;
}

/** Plain-language constraints for PlanDocument.assessment.constraints. */
export function settingConstraints(setting: TrainingSetting): string[] {
  const lines: string[] = [];
  lines.push(
    setting.running === "treadmill"
      ? "All running is indoors on a treadmill this block."
      : "Running is outdoors this block."
  );
  lines.push(
    setting.strength === "gym"
      ? "Strength sessions are in a commercial gym, as a beginner to the equipment — machines, cables and dumbbells rather than barbell lifts."
      : "Strength sessions are bodyweight, done at home."
  );
  if (setting.avoidExercises.length > 0) {
    lines.push(`Never prescribe: ${setting.avoidExercises.join(", ")} (any variation).`);
  }
  return lines;
}

const TREADMILL_REFERENCE = `Every run this block is on a treadmill. Write each run so it can be followed standing at the console:
- Treadmills display speed in km/h, not pace — give every target as a belt speed in km/h with the pace alongside, e.g. "8.6 km/h (about 7:00/km)". Never give a pace alone.
- Set the incline to 1% for steady running (it roughly offsets the missing air resistance); 0% is fine for a warm-up walk.
- Heart rate is the governor, not the belt speed. The speeds you give are starting points: tell him to nudge the belt down 0.2-0.3 km/h whenever HR climbs past the session's ceiling, and that doing so is the session going right, not wrong. Expect HR to run a few beats higher indoors at the same pace — no airflow, so heat builds up; a fan or a spot near the door helps.
- Prescribe by time as well as distance (set "durationMinutes" as well as "distanceMeters"). A wrist watch estimates indoor distance from arm swing and can be off by 5-10%, so the treadmill's own distance, or simply the clock, is what counts — say so once, in the first run of the week.
- Structure each run as explicit console steps: a 5-minute brisk walk to warm up, the running block(s) with speeds, a 3-5 minute walk to cool down. Run/walk intervals are a perfectly good session and easy to do on a treadmill.
- In the first run of the block, include the basics a first-time treadmill user needs, briefly and without talking down: clip the safety key to your top, start the belt while standing on the side rails and step on once it is moving slowly, look ahead rather than at your feet, and slow the belt to a walk before stepping off.
- Keep it from being a slog: vary the sessions across the week (steady, run/walk, a gentle progression), and keep any single continuous block to a length that suits where he is.`;

const OUTDOOR_REFERENCE = `Runs are outdoors. Prescribe by distance and pace in min:sec/km, with the heart-rate ceiling as the limit on easy running.`;

const GYM_STRENGTH_REFERENCE = `The athlete trains in a commercial gym and is a complete beginner to the equipment: he does not yet know how to set up or use most machines. Build sessions he can walk in and do alone, without having to ask anyone.
Equipment, in order of preference: selectorized (pin-loaded) machines, then cable stations, then dumbbells and bodyweight. Machines guide the movement and are the right place to start. Do not prescribe barbell lifts, anything that needs a rack or a spotter, or Olympic lifts in this block.
Session shape — the same four sections, always in this order: Warm-up (2-4 exercises: a few minutes of easy cardio or mobility plus activation for what follows) -> Circuit (the main work: 5-6 exercises) -> Core finisher (2-3 exercises) -> Cool-down (2-4 static stretches). In a gym the "Circuit" section is done as straight sets, not rounds — finish every set of one exercise before moving to the next, because hopping between machines in a busy gym is impractical. So give each Circuit exercise its own "sets" and "restBetweenSetsSeconds", and leave the section's "rounds" and "restBetweenRoundsSeconds" unset.
Volume for a beginner: 2-3 sets of 10-15 reps, 60-90s rest between sets. Stop every set with 2-3 good reps still in hand; nothing goes to failure.
Each session is full-body and covers: a lower-body push (e.g. Leg Press), a hamstring or hip movement (e.g. Leg Curl), an upper-body pull (e.g. Lat Pull-down, Seated Cable Row), an upper-body push, and calves (calf raises matter for a runner). The two sessions in a week should share most of their exercises: a beginner improves fastest by repeating a small set of movements until they are familiar, and it means fewer new machines to learn. Introduce at most one or two new exercises from one week to the next.
Every exercise in every section — warm-up and cool-down included — must be an exact Garmin Connect exercise name from the list below; never invent one or describe one in free text. One exercise per step, never a combined choice.
Progression across weeks: keep the same exercises. First add reps toward the top of the range, then a third set, and only then the next weight step — one pin or the smallest dumbbell jump. Say in the how-to when this week is the week to move up.`;

const BODYWEIGHT_STRENGTH_REFERENCE = `Foundation-level session structure (beginner, base phase — the athlete's current level): 2-3 sets x 12-15 reps, bodyweight only — add light dumbbells/kettlebell only once bodyweight feels easy across all sets. Every session includes core work (a plank/anti-rotation move, a hip-hinge or bridge move, a single-leg balance move). Include run-specific focus exercises across sessions: lunges, Romanian deadlifts (bodyweight/light-load for a beginner), calf raises, single-leg work (single-leg balance, step-ups).
Structure (four sections, always in this order): Warm-up (2-4 light mobility/activation moves) → Circuit (4-6 exercises done for 2-3 rounds) → Core finisher (2-3 exercises) → Cool-down (2-4 static stretches). Every exercise in every section — including warm-up and cool-down — must be an exact Garmin Connect exercise name from the list below; never invent one or describe one in free text instead of picking a list entry.
One exercise per step, never a combined choice: Garmin Connect lists close variants as separate, distinct exercises (e.g. "Push-up" and "Knee Push-up" are two different list entries) — commit to one specific exercise, never something like "Push-ups (knee or full)" that tries to name two entries at once. If you want an easier or harder version for this athlete, pick that specific variant's own list entry.
Rest scheme (this athlete has no rest-timer habit yet, so be explicit and a little conservative): 30-45s between sets for most circuit bodyweight/light-dumbbell exercises, 45-60s for anything loaded or hinge-pattern (deadlift variations, weighted step-ups); core-finisher holds usually need less, 20-30s; between circuit rounds, 45-90s depending on how taxing the round was. Warm-up/cool-down exercises don't need rest fields.
Progression across weeks: keep the same movement patterns — progress by adding a round, moving toward the top of the rep range, or tightening form/tempo (and only trim rest time once the athlete is clearly recovering fully within it). Only add a light external load once bodyweight feels genuinely easy across all sets; never jump straight to heavier weights as the first progression.`;

const HOW_TO_REFERENCE = `Every Circuit and Core finisher exercise must carry a "howTo": two to four short sentences that let someone who has never touched the equipment do it correctly, alone, the first time. Cover, in this order:
1. Setup — which machine or station it is and how to recognise it, and what to adjust before starting (seat height, back pad, where the pin goes in the weight stack, which handle to clip on a cable).
2. The movement — one rep in plain words, and the single most useful cue or the mistake to avoid.
3. Starting weight — he has no numbers yet, so give a way to find one: start with a light pin or light dumbbells, and settle on the weight where the last two reps of the set are work but still tidy. A first set that turns out too light is the right way round.
Write it the way a good coach talks someone through a first session: plain, specific and matter-of-fact, never apologetic or patronising. Warm-up and cool-down exercises need a "howTo" only where the name alone would not tell a beginner what to do. When an exercise repeats from the previous week, keep its how-to short or update it with the progression.`;

export function runningReference(setting: TrainingSetting): string {
  return setting.running === "treadmill" ? TREADMILL_REFERENCE : OUTDOOR_REFERENCE;
}

export function strengthReference(setting: TrainingSetting): string {
  const parts = [setting.strength === "gym" ? GYM_STRENGTH_REFERENCE : BODYWEIGHT_STRENGTH_REFERENCE];
  if (setting.explainExercises) parts.push(HOW_TO_REFERENCE);
  if (setting.avoidExercises.length > 0) {
    parts.push(
      `Never prescribe: ${setting.avoidExercises.join(", ")} — in any variation. These have already been removed from the exercise list below. Do not work around the gap with the nearest equivalent on the same equipment; train the same muscles a different way (for a pressing movement: a chest-press machine, push-ups, or dumbbell or cable work). Do not mention the exclusion in anything the athlete reads — just build the session without it.`
    );
  }
  return parts.join("\n");
}
