import { config } from "dotenv";
config({ path: ".env.local", quiet: true });
config({ quiet: true }); // fall back to .env for anything not in .env.local
import { and, desc, eq, gte, lte } from "drizzle-orm";
import { db } from "../src/lib/db/client";
import {
  plans,
  planWorkouts,
  planWorkoutExercises,
  activities,
  zoneVersions,
} from "../src/lib/db/schema";
import {
  flattenPlanWorkouts,
  type PlanDocument,
  type PlanWeekJson,
  type PlanDayJson,
  type PlanWorkoutJson,
  type StrengthWorkoutJson,
  type ExternalSkeletonWeek,
  type ExternalSkeletonSession,
} from "../src/lib/coaching/plan";
import { getAllExercises } from "../src/lib/coaching/exerciseCatalog";
import { flattenStrengthExercises } from "../src/lib/coaching/strengthSchema";

/**
 * Replaces the app's self-authored "Return to Running" plan with the Runna
 * plan Edu actually started on 2026-09-07, and pins the app to it.
 *
 * Why this exists rather than another regeneration cycle: the two plans had
 * diverged into direct conflict. The app believed Edu was restarting from a
 * 9-week layoff and kept prescribing 2.5km run/walk intervals under a hard
 * 156bpm ceiling, reading every Runna session as a missed workout plus a
 * Zone 3 "drift", and cutting volume further each Sunday in response. Edu was
 * meanwhile running Runna's plan more or less as written. The app's numbers
 * were a coherent answer to a question that had stopped being true.
 *
 * Runna now owns the structure (which day, which session type, how far).
 * This app owns everything Runna doesn't give him: HR-zone targets read
 * against his own data, per-session execution coaching, the two gym sessions,
 * and the weekly debrief. See ExternalPlanSource in src/lib/coaching/plan.ts —
 * the Sunday regeneration job reads that skeleton and is no longer allowed to
 * rewrite the structure underneath him.
 *
 * Source: "Functional Fitness Plan Overview.pdf", exported from Runna
 * 2026-09-07. The PDF is a one-page grid — it gives each session's day,
 * headline distance and Runna's own name for it ("Extended Kms", "Mile
 * Repeats"), but not the rep-by-rep breakdown. So every quality session below
 * carries Runna's label and distance verbatim and adds this app's HR/pace
 * targets and execution notes on top; the authoritative rep structure stays
 * in the Runna app itself, and the session text says so.
 *
 * Run with: npx tsx scripts/import-runna-plan.ts [--dry-run]
 */

const DRY_RUN = process.argv.includes("--dry-run");

const PROVIDER = "Runna";
const PLAN_NAME = "8 Week Functional Fitness Plan";
const SOURCE_DOCUMENT = "Functional Fitness Plan Overview.pdf (exported from Runna, 2026-09-07)";
const RACE_DATE = "2026-11-01";
const IMPORTED_AT = new Date().toISOString();

// ---------------------------------------------------------------------------
// Zone targets
//
// HRmax (195) is athlete-provided and exact, so HR is the authoritative target
// throughout. The pace zones in the DB derive from a 35:00 5K that predates
// the layoff and are demonstrably stale — Edu's Sep 20 long run averaged
// 6:43/km at 164bpm, well inside a table that calls 6:52-7:39/km "Tempo", and
// the metrics pipeline has been returning intensity factors above 1.0 on runs
// labelled easy. So pace guidance below comes from his own last-fortnight
// numbers, quoted as a sanity check on the HR target rather than as a zone.
// ---------------------------------------------------------------------------
const ZONE_EASY = "Zone 1-2 (HR <156bpm)";
const ZONE_LONG = "Zone 1-2 (HR <156bpm)";
const ZONE_THRESHOLD = "Zone 3-4 (HR 157-186bpm)";
const ZONE_INTERVAL = "Zone 4-5 (HR 172bpm+)";
const ZONE_RACE = "Zone 3-4 (HR 157-186bpm)";
const ZONE_STRENGTH = "N/A (strength)";

const PACE_EASY = "7:30-8:15/km";
const PACE_LONG = "7:15-8:00/km";
const PACE_THRESHOLD = "6:20-6:40/km";
const PACE_INTERVAL = "5:50-6:10/km";

// The one correction this block is built around — see the rationale below.
const EASY_DAY_RULE =
  "Hard ceiling 156bpm. If HR climbs past it, slow down or walk until it drops back under ~145bpm, then carry on. Finishing able to hold a full conversation is the whole point of this session.";

// ---------------------------------------------------------------------------
// The Runna grid, transcribed from the PDF. Mon/Wed/Thu/Sat are rest days in
// Runna's own plan; the Mon/Thu strength sessions are this app's addition
// (flagged addedByApp) and are rest from *running* either way.
// ---------------------------------------------------------------------------
interface RunnaSession {
  label: string;
  type: "intervals" | "tempo" | "easy" | "long" | "race";
  km: number;
}
interface RunnaWeek {
  weekNumber: number;
  startDate: string;
  tuesday: RunnaSession;
  friday: RunnaSession;
  sunday: RunnaSession;
}

const RUNNA_WEEKS: RunnaWeek[] = [
  {
    weekNumber: 1,
    startDate: "2026-09-07",
    tuesday: { label: "Drop Set", type: "intervals", km: 3 },
    friday: { label: "Easy Run", type: "easy", km: 3 },
    sunday: { label: "Long Run", type: "long", km: 4 },
  },
  {
    weekNumber: 2,
    startDate: "2026-09-14",
    tuesday: { label: "On and Offs", type: "intervals", km: 4 },
    friday: { label: "Easy Run", type: "easy", km: 4 },
    sunday: { label: "Long Run", type: "long", km: 5 },
  },
  {
    weekNumber: 3,
    startDate: "2026-09-21",
    tuesday: { label: "Extended Kms", type: "tempo", km: 5 },
    friday: { label: "Easy Run", type: "easy", km: 3 },
    sunday: { label: "Long Run", type: "long", km: 6 },
  },
  {
    weekNumber: 4,
    startDate: "2026-09-28",
    tuesday: { label: "Mile Repeats", type: "intervals", km: 4 },
    friday: { label: "Easy Run", type: "easy", km: 3 },
    sunday: { label: "Long Run", type: "long", km: 5 },
  },
  {
    weekNumber: 5,
    startDate: "2026-10-05",
    tuesday: { label: "Tempo 2k", type: "tempo", km: 5 },
    friday: { label: "Easy Run", type: "easy", km: 4 },
    sunday: { label: "Long Run", type: "long", km: 7 },
  },
  {
    weekNumber: 6,
    startDate: "2026-10-12",
    tuesday: { label: "Progressive Mile Repeats", type: "intervals", km: 5 },
    friday: { label: "Easy Run", type: "easy", km: 5 },
    sunday: { label: "Long Run", type: "long", km: 8 },
  },
  {
    weekNumber: 7,
    startDate: "2026-10-19",
    tuesday: { label: "Shorter Intervals", type: "intervals", km: 6.2 },
    friday: { label: "Easy Run", type: "easy", km: 3 },
    sunday: { label: "Long Run", type: "long", km: 7 },
  },
  {
    weekNumber: 8,
    startDate: "2026-10-26",
    tuesday: { label: "Race Pace Practice K's", type: "intervals", km: 5 },
    friday: { label: "Easy Run", type: "easy", km: 3 },
    sunday: { label: "8km Race", type: "race", km: 8 },
  },
];

const WEEK_FOCUS: Record<number, string> = {
  1: "Plan start — re-establishing the three-run rhythm.",
  2: "Second build week, first proper interval session.",
  3: "Longest week so far — threshold work Tuesday, 6km long run Sunday.",
  4: "Down week on volume. The quality session stays; the easy days get easier.",
  5: "Biggest aerobic week yet — a continuous tempo block and a 7km long run.",
  6: "Peak week. 8km long run, the longest of the block.",
  7: "Sharpening — faster, shorter reps and a pull-back in long-run distance.",
  8: "Race week. Everything taper; Sunday is the 8km.",
};

const RECOVERY_WEEKS = new Set([4, 8]);

function addDays(dateStr: string, days: number): string {
  const d = new Date(`${dateStr}T00:00:00Z`);
  d.setUTCDate(d.getUTCDate() + days);
  return d.toISOString().slice(0, 10);
}

function dayOfWeekName(dateStr: string): string {
  return new Date(`${dateStr}T00:00:00Z`).toLocaleDateString("en-US", {
    weekday: "long",
    timeZone: "UTC",
  });
}

function zoneFor(session: RunnaSession): string {
  switch (session.type) {
    case "easy":
      return ZONE_EASY;
    case "long":
      return ZONE_LONG;
    case "tempo":
      return ZONE_THRESHOLD;
    case "intervals":
      return ZONE_INTERVAL;
    case "race":
      return ZONE_RACE;
  }
}

// ---------------------------------------------------------------------------
// Session text. Quality sessions defer to Runna for the rep structure and
// supply targets + execution coaching; easy and long runs are prescribed in
// full, because those are the sessions the data says are going wrong.
// ---------------------------------------------------------------------------

const QUALITY_INTENT: Record<string, string> = {
  "Drop Set": "Reps that get shorter as you go, each one a little quicker than the last.",
  "On and Offs": "Alternating blocks of faster running and easy running, no standing recovery.",
  "Extended Kms": "Long reps at a controlled, comfortably-hard effort — sustained, not sprinted.",
  "Mile Repeats": "Two long reps at threshold effort with a jog between them.",
  "Tempo 2k": "A continuous 2km block held at threshold, inside an easy warm-up and cool-down.",
  "Progressive Mile Repeats": "Long reps where each one is slightly faster than the one before.",
  "Shorter Intervals": "Short, fast reps with full recoveries — the quickest running of the block.",
  "Race Pace Practice K's": "Reps at your intended 8km race pace, to rehearse the feel of it.",
};

function qualityText(week: RunnaWeek, session: RunnaSession): string {
  const isVo2 = session.type === "intervals" && session.label === "Shorter Intervals";
  const pace = isVo2 ? PACE_INTERVAL : PACE_THRESHOLD;
  const zone = isVo2 ? "Zone 4-5, 172bpm and up on the reps" : "Zone 3-4, roughly 157-186bpm on the reps";

  return [
    `${PROVIDER} session: "${session.label}", ${session.km}km total. ${QUALITY_INTENT[session.label] ?? ""}`.trim(),
    "",
    `Run the rep structure exactly as the ${PROVIDER} app gives it to you — it has the reps and recoveries, and it is the source of truth for this session.`,
    "",
    `Your targets for it: ${zone}, around ${pace} on the fast sections. Recoveries should be a genuine jog or walk — let HR come back down before the next rep rather than rolling straight into it.`,
    "",
    "This is the one session in the week that is supposed to feel hard. Spend the effort here, and it buys you the right to run Friday and Sunday genuinely easy.",
  ].join("\n");
}

function easyText(session: RunnaSession): string {
  return [
    `Easy aerobic run, ${session.km}km continuous.`,
    "",
    `Target: Zone 1-2, HR under 156bpm, roughly ${PACE_EASY}.`,
    EASY_DAY_RULE,
    "",
    "This one exists to add aerobic volume without adding fatigue. Running it at 6:50/km because it feels fine is how a three-run week turns into three hard days.",
  ].join("\n");
}

function longText(week: RunnaWeek, session: RunnaSession): string {
  const lines = [
    `Long run, ${session.km}km, easy and unhurried — time on feet, not pace.`,
    "",
    `Target: Zone 1-2, HR under 156bpm, roughly ${PACE_LONG}.`,
    EASY_DAY_RULE,
  ];
  if (week.weekNumber === 3) {
    lines.push(
      "",
      "Specifically this week: your last two long runs averaged 158 and 164bpm — both Zone 3 for the whole run. Start the first kilometre slower than feels right, check HR at every kilometre, and let it be boring. Sunday being easy is what makes Tuesday possible."
    );
  }
  if (week.weekNumber === 6) {
    lines.push(
      "",
      "Longest run of the block. Take a walk break at the halfway point if you need one — finishing 8km controlled beats running 6km well and 2km badly."
    );
  }
  return lines.join("\n");
}

function raceText(session: RunnaSession): string {
  return [
    `Race day — ${session.km}km.`,
    "",
    `Target: Zone 3-4. Go out at the pace you rehearsed on Tuesday of race week (around ${PACE_THRESHOLD}), not faster — the first kilometre always feels too easy, and that is correct.`,
    "",
    "Warm up with 10 minutes of easy jogging plus a few short strides. Then settle in, hold the effort through the middle, and spend whatever is left in the last kilometre.",
  ].join("\n");
}

function runWorkoutText(week: RunnaWeek, session: RunnaSession): string {
  switch (session.type) {
    case "easy":
      return easyText(session);
    case "long":
      return longText(week, session);
    case "race":
      return raceText(session);
    default:
      return qualityText(week, session);
  }
}

// ---------------------------------------------------------------------------
// Strength. Two alternating templates, progressed across the block — the same
// movement patterns throughout, adding a round and moving up the rep range
// rather than adding load, per the app's own strength reference. Every
// exercise name is validated against the Garmin catalog before insert.
// ---------------------------------------------------------------------------

type Phase = "base" | "build" | "peak" | "taper";

function phaseForWeek(weekNumber: number): Phase {
  if (weekNumber <= 2) return "base";
  if (weekNumber <= 5) return "build";
  if (weekNumber <= 7) return "peak";
  return "taper";
}

function roundsFor(phase: Phase): { rounds: string; squat: string; pushup: string; plank: string } {
  switch (phase) {
    case "base":
      return { rounds: "2", squat: "12-15", pushup: "10-12", plank: "30-40s" };
    case "build":
      return { rounds: "2-3", squat: "12-15", pushup: "10-12", plank: "35-45s" };
    case "peak":
      return { rounds: "3", squat: "15", pushup: "12", plank: "45-60s" };
    case "taper":
      return { rounds: "2", squat: "12", pushup: "10", plank: "30s" };
  }
}

function strengthA(weekNumber: number): StrengthWorkoutJson {
  const p = roundsFor(phaseForWeek(weekNumber));
  return {
    sections: [
      {
        label: "Warm-up",
        exercises: [
          { exerciseName: "Jumping Jacks", reps: "30-40" },
          { exerciseName: "Arm Circles", reps: "20 total" },
          { exerciseName: "Hip Circles", reps: "8 each side" },
          { exerciseName: "Walking Knee Hugs", reps: "8 each side" },
        ],
      },
      {
        label: "Circuit",
        rounds: p.rounds,
        restBetweenRoundsSeconds: 60,
        exercises: [
          { exerciseName: "Air Squat", reps: p.squat, restBetweenSetsSeconds: 40 },
          { exerciseName: "Kneeling Push-up", reps: p.pushup, restBetweenSetsSeconds: 40 },
          { exerciseName: "Hip Raise", reps: "12-15", restBetweenSetsSeconds: 40 },
          { exerciseName: "Reverse Lunge with Reach Back", reps: "8 each side", restBetweenSetsSeconds: 45 },
          { exerciseName: "Standing Calf Raise", reps: "15", restBetweenSetsSeconds: 30 },
        ],
      },
      {
        label: "Core finisher",
        exercises: [
          { exerciseName: "Plank", sets: 2, reps: p.plank, restBetweenSetsSeconds: 30 },
          { exerciseName: "Dead Bug", sets: 2, reps: "10 each side", restBetweenSetsSeconds: 25 },
        ],
      },
      {
        label: "Cool-down",
        exercises: [
          { exerciseName: "Hamstring Stretch", reps: "30s each side" },
          { exerciseName: "Lunging Hip Flexor Stretch", reps: "30s each side" },
          { exerciseName: "Calf Stretch", reps: "30s each side" },
          { exerciseName: "Child's Pose Stretch", reps: "45s" },
        ],
      },
    ],
  };
}

function strengthB(weekNumber: number): StrengthWorkoutJson {
  const p = roundsFor(phaseForWeek(weekNumber));
  return {
    sections: [
      {
        label: "Warm-up",
        exercises: [
          { exerciseName: "Jumping Jacks", reps: "30-40" },
          { exerciseName: "Cat Cow Stretch", reps: "8 slow reps" },
          { exerciseName: "Forward and Backward Leg Swings", reps: "10 each side" },
          { exerciseName: "Inchworm", reps: "5" },
        ],
      },
      {
        label: "Circuit",
        rounds: p.rounds,
        restBetweenRoundsSeconds: 60,
        exercises: [
          { exerciseName: "Air Squat", reps: p.squat, restBetweenSetsSeconds: 40 },
          { exerciseName: "Kneeling Push-up", reps: p.pushup, restBetweenSetsSeconds: 40 },
          { exerciseName: "Single-leg Hip Raise", reps: "8 each side", restBetweenSetsSeconds: 45 },
          { exerciseName: "Step-up", reps: "10 each side", restBetweenSetsSeconds: 45 },
          { exerciseName: "Single-leg Standing Calf Raise", reps: "10 each side", restBetweenSetsSeconds: 30 },
        ],
      },
      {
        label: "Core finisher",
        exercises: [
          { exerciseName: "Side Plank", sets: 2, reps: "20-30s each side", restBetweenSetsSeconds: 30 },
          { exerciseName: "Quadruped with Leg Lift", sets: 2, reps: "8 each side", restBetweenSetsSeconds: 25 },
        ],
      },
      {
        label: "Cool-down",
        exercises: [
          { exerciseName: "Glutes Stretch", reps: "30s each side" },
          { exerciseName: "Quad Stretch", reps: "30s each side" },
          { exerciseName: "Calf Stretch", reps: "30s each side" },
          { exerciseName: "Lying Spinal Twist Stretch", reps: "30s each side" },
        ],
      },
    ],
  };
}

/** Race week's Thursday: mobility only, nothing that leaves a trace in the legs. */
function strengthTaperMobility(): StrengthWorkoutJson {
  return {
    sections: [
      {
        label: "Warm-up",
        exercises: [
          { exerciseName: "Cat Cow Stretch", reps: "8 slow reps" },
          { exerciseName: "Hip Circles", reps: "8 each side" },
          { exerciseName: "Forward and Backward Leg Swings", reps: "10 each side" },
        ],
      },
      {
        label: "Core finisher",
        exercises: [{ exerciseName: "Plank", sets: 2, reps: "30s", restBetweenSetsSeconds: 30 }],
      },
      {
        label: "Cool-down",
        exercises: [
          { exerciseName: "Glutes Stretch", reps: "30s each side" },
          { exerciseName: "Hamstring Stretch", reps: "30s each side" },
          { exerciseName: "Calf Stretch", reps: "30s each side" },
          { exerciseName: "Child's Pose Stretch", reps: "45s" },
        ],
      },
    ],
  };
}

function formatStrength(s: StrengthWorkoutJson): string {
  return s.sections
    .map((section) => {
      const head =
        section.label === "Circuit" && section.rounds
          ? `Circuit (${section.rounds} rounds${
              section.restBetweenRoundsSeconds ? `, ${section.restBetweenRoundsSeconds}s rest between rounds` : ""
            }):`
          : `${section.label}:`;
      const body = section.exercises
        .map((e) => {
          const sets = e.sets ? `${e.sets}x` : "";
          const rest = e.restBetweenSetsSeconds ? ` (${e.restBetweenSetsSeconds}s rest)` : "";
          return `  - ${e.exerciseName} ${sets}${e.reps}${rest}`;
        })
        .join("\n");
      return `${head}\n${body}`;
    })
    .join("\n");
}

function strengthWorkout(weekNumber: number, slot: "A" | "B"): PlanWorkoutJson {
  const isTaperThursday = weekNumber === 8 && slot === "B";
  const strength = isTaperThursday
    ? strengthTaperMobility()
    : slot === "A"
      ? strengthA(weekNumber)
      : strengthB(weekNumber);
  const name = isTaperThursday
    ? "Mobility & Activation (race week)"
    : `Full-Body Strength ${slot} (week ${weekNumber})`;
  const humanReadable = isTaperThursday
    ? `Race week — mobility only, no loading. Nothing here should leave a trace in your legs on Sunday.\n\n${formatStrength(strength)}`
    : formatStrength(strength);
  return {
    id: "", // assigned by buildWeek
    sport: "strength",
    type: isTaperThursday ? "mobility" : "strength",
    name,
    description: humanReadable,
    durationMinutes: isTaperThursday ? 15 : 35,
    primaryZone: ZONE_STRENGTH,
    humanReadable,
    strength,
    completed: false,
  };
}

function restWorkout(note: string): PlanWorkoutJson {
  return {
    id: "",
    sport: "rest",
    name: "Rest Day",
    primaryZone: "N/A (rest)",
    description: note,
    humanReadable: note,
    completed: false,
  };
}

// ---------------------------------------------------------------------------
// Week assembly
// ---------------------------------------------------------------------------

const REST_NOTES: Record<string, string> = {
  Wednesday: "Full rest between Tuesday's quality session and Friday's easy run. A relaxed walk is fine.",
  Saturday: "Full rest. Legs fresh for tomorrow's long run.",
};

function buildWeek(week: RunnaWeek): { planWeek: PlanWeekJson; skeleton: ExternalSkeletonWeek } {
  const endDate = addDays(week.startDate, 6);
  const days: PlanDayJson[] = [];
  const skeletonDays: ExternalSkeletonWeek["days"] = [];

  for (let i = 0; i < 7; i++) {
    const date = addDays(week.startDate, i);
    const dayName = dayOfWeekName(date);
    const workouts: PlanWorkoutJson[] = [];
    const sessions: ExternalSkeletonSession[] = [];

    if (dayName === "Monday") {
      workouts.push(strengthWorkout(week.weekNumber, "A"));
      sessions.push({
        sport: "strength",
        type: "strength",
        label: `Full-Body Strength A (week ${week.weekNumber})`,
        durationMinutes: 35,
        primaryZone: ZONE_STRENGTH,
        addedByApp: true,
        note: "Runna prescribes rest from running here; the gym session is this app's addition.",
      });
    } else if (dayName === "Thursday") {
      workouts.push(strengthWorkout(week.weekNumber, "B"));
      sessions.push({
        sport: "strength",
        type: week.weekNumber === 8 ? "mobility" : "strength",
        label:
          week.weekNumber === 8
            ? "Mobility & Activation (race week)"
            : `Full-Body Strength B (week ${week.weekNumber})`,
        durationMinutes: week.weekNumber === 8 ? 15 : 35,
        primaryZone: ZONE_STRENGTH,
        addedByApp: true,
        note: "Runna prescribes rest from running here; the gym session is this app's addition.",
      });
    } else if (dayName === "Tuesday" || dayName === "Friday" || dayName === "Sunday") {
      const session =
        dayName === "Tuesday" ? week.tuesday : dayName === "Friday" ? week.friday : week.sunday;
      const zone = zoneFor(session);
      const text = runWorkoutText(week, session);
      workouts.push({
        id: "",
        sport: "run",
        type: session.type,
        name: session.type === "race" ? session.label : `${session.label} (${PROVIDER})`,
        description: text,
        distanceMeters: Math.round(session.km * 1000),
        primaryZone: zone,
        humanReadable: text,
        completed: false,
      });
      sessions.push({
        sport: "run",
        type: session.type,
        label: session.label,
        distanceMeters: Math.round(session.km * 1000),
        primaryZone: zone,
        note: `${PROVIDER} prescribes this session; distance and type are fixed.`,
      });
    } else {
      const note = REST_NOTES[dayName] ?? "Full rest.";
      workouts.push(restWorkout(note));
      sessions.push({ sport: "rest", type: "rest", label: "Rest Day", note });
    }

    for (const [idx, w] of workouts.entries()) {
      w.id = `w${week.weekNumber}-${date}-${w.sport}${idx > 0 ? `-${idx}` : ""}`;
    }
    days.push({ date, dayOfWeek: dayName, workouts });
    skeletonDays.push({ date, sessions });
  }

  const runKm = week.tuesday.km + week.friday.km + week.sunday.km;
  const planWeek: PlanWeekJson = {
    weekNumber: week.weekNumber,
    startDate: week.startDate,
    endDate,
    phase: phaseForWeek(week.weekNumber),
    focus: WEEK_FOCUS[week.weekNumber],
    targetHours: Math.round(((runKm * 7.3) / 60 + 2 * 0.58) * 10) / 10,
    isRecoveryWeek: RECOVERY_WEEKS.has(week.weekNumber),
    days,
  };

  return {
    planWeek,
    skeleton: {
      weekNumber: week.weekNumber,
      startDate: week.startDate,
      endDate,
      focus: WEEK_FOCUS[week.weekNumber],
      isRecoveryWeek: RECOVERY_WEEKS.has(week.weekNumber),
      days: skeletonDays,
    },
  };
}

// ---------------------------------------------------------------------------

const RATIONALE = `Rebuilt from scratch against the Runna "8 Week Functional Fitness Plan" you started on 7 September, which this app knew nothing about. Until now it believed you were restarting from a nine-week layoff, so it was prescribing 2.5km run/walk intervals under a 156bpm ceiling while you were out running Runna's sessions — it scored every one of those as a missed workout plus a Zone 3 drift, and cut your volume another 35% on Sunday in response. Runna now owns the structure through race day on 1 November and the Sunday job can no longer overwrite it.

What the Strava data from the last fortnight actually says: you have run five of the six sessions Runna prescribed, missing only Friday 18 September. Cadence has climbed from 73 to 77 across those runs, which is a real improvement. The problem is intensity distribution — your two long runs averaged 158 and 164bpm, both squarely Zone 3, and the metrics pipeline has been returning intensity factors above 1.0 on runs labelled easy. With Runna now adding a genuine hard session every Tuesday, running Friday and Sunday at that effort too would give you three hard days a week, which is how this block ends early.

So the structure is Runna's and the coaching is the correction: every easy and long run carries a hard 156bpm ceiling and an explicit instruction to walk it back down, and the Tuesday session is where the effort is meant to go. Gym stays on Monday and Thursday, same movement patterns throughout, progressing by adding a round rather than load, dropping to mobility only in race week.`;

async function main() {
  // ---- Validate every exercise name against the Garmin catalog up front.
  const allExercises = await getAllExercises();
  const known = new Set(allExercises.map((e) => e.name));
  const used = new Set<string>();
  for (let wn = 1; wn <= 8; wn++) {
    for (const s of [strengthA(wn), strengthB(wn), strengthTaperMobility()]) {
      for (const section of s.sections) for (const e of section.exercises) used.add(e.exerciseName);
    }
  }
  const unknown = [...used].filter((n) => !known.has(n));
  if (unknown.length > 0) {
    throw new Error(
      `These exercise names are not in the Garmin catalog and would not be typeable into Garmin Connect: ${unknown.join(", ")}`
    );
  }
  console.log(`Validated ${used.size} exercise names against the Garmin catalog.`);

  // ---- Build the plan document.
  const built = RUNNA_WEEKS.map(buildWeek);
  const weeks = built.map((b) => b.planWeek);
  const skeleton = built.map((b) => b.skeleton);

  const [currentZones] = await db
    .select()
    .from(zoneVersions)
    .where(eq(zoneVersions.isCurrent, true))
    .orderBy(desc(zoneVersions.asOfDate))
    .limit(1);

  const [previous] = await db
    .select()
    .from(plans)
    .where(eq(plans.isActive, true))
    .limit(1);
  if (!previous) throw new Error("No active plan to supersede — is the DB seeded?");
  const previousJson = previous.planJson as PlanDocument;

  // ---- Mark weeks 1-2 against what actually happened on Strava.
  const done = await db
    .select()
    .from(activities)
    .where(
      and(
        gte(activities.startDateLocal, new Date("2026-09-07T00:00:00Z")),
        lte(activities.startDateLocal, new Date("2026-09-20T23:59:59Z"))
      )
    );
  let matched = 0;
  for (const week of weeks.filter((w) => w.weekNumber <= 2)) {
    for (const day of week.days) {
      for (const workout of day.workouts) {
        if (workout.sport === "rest") continue;
        const hit = done.find((a) => {
          const d = a.startDateLocal.toISOString().slice(0, 10);
          if (d !== day.date) return false;
          return workout.sport === "run"
            ? a.sportType === "Run"
            : a.sportType === "WeightTraining" || a.sportType === "Workout";
        });
        if (hit) {
          workout.completed = true;
          matched++;
        }
      }
    }
  }
  console.log(`Marked ${matched} sessions in weeks 1-2 as completed from Strava.`);

  const plan: PlanDocument = {
    version: "1.0",
    meta: {
      id: "runna-functional-fitness-2026-11-01",
      athlete: previousJson.meta.athlete,
      event: "8km Race (Runna 8 Week Functional Fitness Plan)",
      eventDate: RACE_DATE,
      planStartDate: RUNNA_WEEKS[0].startDate,
      planEndDate: RACE_DATE,
      createdAt: IMPORTED_AT,
      updatedAt: IMPORTED_AT,
      totalWeeks: RUNNA_WEEKS.length,
      generatedBy: `Claude Coach (structure imported from ${PROVIDER})`,
    },
    preferences: previousJson.preferences,
    assessment: {
      foundation: {
        ...(previousJson.assessment.foundation as Record<string, unknown>),
        raceHistory: [
          "10K training block (Runna), Oct-Dec 2025",
          "Speed-focused 'Run Faster' block (Runna), Jan-Apr 2026",
          "Runna 8 Week Functional Fitness plan started 2026-09-07, 8km race 2026-11-01",
        ],
      },
      currentForm: {
        weeklyVolume: { total: 12, run: 12 },
        longestSessions: { run: 5 },
        consistency:
          "Back to running three times a week since 2026-09-07 on a Runna plan. Five of six prescribed sessions completed in the first two weeks (missed Friday 2026-09-18). Cadence improving, 73 to 77 spm. CTL ~13.6, ACWR ~1.18 as of 2026-09-20.",
      },
      strengths: [
        {
          sport: "run",
          evidence:
            "Five of six Runna sessions completed in the first fortnight back — the three-runs-a-week habit is holding.",
        },
        {
          sport: "run",
          evidence: "Cadence rose from 73 to 77 spm across the first two weeks of the block.",
        },
      ],
      limiters: [
        {
          sport: "run",
          evidence:
            "Easy and long runs are being run at Zone 3 effort — 2026-09-13 averaged 158bpm and 2026-09-20 averaged 164bpm, both prescribed easy. With a hard Runna session every Tuesday this is the main risk in the block.",
        },
        {
          sport: "run",
          evidence:
            "Pace zones derive from a 35:00 5K that predates the layoff and are stale — the metrics pipeline returns intensity factors above 1.0 on easy runs. HR is the authoritative target until a fresh time trial or a qualifying effort updates them.",
        },
        {
          sport: "run",
          evidence:
            "Strava history shows a lower-leg (shin) issue and recovery block in Aug 2025 — a reason to hold the easy days genuinely easy rather than to cut Runna's volume.",
        },
      ],
      constraints: [
        "Running days are fixed by Runna: Tuesday (quality), Friday (easy), Sunday (long).",
        "Gym on Monday and Thursday — this app's addition, on Runna's rest-from-running days.",
        "Race: 8km on 2026-11-01.",
        "Runna owns session structure and distance; this app owns pacing, HR targets, strength and commentary.",
      ],
    },
    zones: currentZones
      ? {
          run: {
            hr: {
              lthr: null,
              source: currentZones.source,
              zones: currentZones.hrZones as PlanDocument["zones"]["run"]["hr"]["zones"],
            },
            pace: {
              source: `${currentZones.source} — STALE, derived from a 35:00 5K predating the 2026 layoff. Prescribe by HR.`,
              zones: currentZones.paceZones as PlanDocument["zones"]["run"]["pace"]["zones"],
            },
            note: "HRmax 195 is athlete-provided and exact, so HR zones are authoritative. Pace guidance in session text comes from observed 2026-09 running, not from the stale pace table.",
          },
        }
      : previousJson.zones,
    externalPlan: {
      provider: PROVIDER,
      planName: PLAN_NAME,
      importedAt: IMPORTED_AT,
      sourceDocument: SOURCE_DOCUMENT,
      note:
        "Structure (day, session type, distance) is fixed by Runna through race day. The Sunday regeneration job may only write pacing, HR targets, strength detail and rationale on top of it. The PDF gives Runna's session names and headline distances but not rep-by-rep detail, so quality sessions defer to the Runna app for exact reps.",
      weeks: skeleton,
    },
    phases: [
      {
        name: "base",
        startWeek: 1,
        endWeek: 2,
        focus: "Re-establish the three-run week and the habit.",
        keyWorkouts: ["Drop Set", "On and Offs"],
      },
      {
        name: "build",
        startWeek: 3,
        endWeek: 5,
        focus: "Add threshold work and build the long run, while forcing the easy days genuinely easy.",
        keyWorkouts: ["Extended Kms", "Mile Repeats", "Tempo 2k"],
      },
      {
        name: "peak",
        startWeek: 6,
        endWeek: 7,
        focus: "Peak long run, then sharpen with faster, shorter reps.",
        keyWorkouts: ["Progressive Mile Repeats", "Shorter Intervals"],
      },
      {
        name: "taper",
        startWeek: 8,
        endWeek: 8,
        focus: "Taper into the 8km race on 1 November.",
        keyWorkouts: ["Race Pace Practice K's", "8km Race"],
      },
    ],
    weeks,
  };

  const flattened = flattenPlanWorkouts(plan);
  const totalRunKm =
    flattened.filter((r) => r.sport === "run").reduce((s, r) => s + (r.distanceMeters ?? 0), 0) / 1000;

  console.log(
    `Built ${plan.weeks.length} weeks, ${flattened.length} workouts, ${totalRunKm.toFixed(1)}km of running total.`
  );

  if (DRY_RUN) {
    console.log("--dry-run: nothing written.");
    process.exit(0);
  }

  const newVersion = previous.version + 1;
  const [inserted] = await db
    .insert(plans)
    .values({
      version: newVersion,
      weekStartDate: "2026-09-21", // the first week this plan takes effect for
      source: "manual",
      rationale: RATIONALE,
      guardrailsApplied: {
        pinnedTo: { provider: PROVIDER, planName: PLAN_NAME, sourceDocument: SOURCE_DOCUMENT },
        supersededVersion: previous.version,
        note: "Imported, not generated — guardrails did not author this week.",
      },
      planJson: plan,
      isActive: true,
    })
    .returning({ id: plans.id });

  await db.update(plans).set({ isActive: false }).where(eq(plans.id, previous.id));

  const insertedWorkouts = await db
    .insert(planWorkouts)
    .values(
      flattened.map((row) => ({
        planId: inserted.id,
        date: row.date,
        dayOfWeek: row.dayOfWeek,
        workoutKey: row.workoutKey,
        sport: row.sport,
        type: row.type,
        name: row.name,
        description: row.description,
        durationMinutes: row.durationMinutes,
        distanceMeters: row.distanceMeters,
        primaryZone: row.primaryZone,
        humanReadable: row.humanReadable,
        completed: row.completed,
      }))
    )
    .returning({ id: planWorkouts.id, workoutKey: planWorkouts.workoutKey });

  const byKey = new Map(insertedWorkouts.map((w) => [w.workoutKey, w.id]));
  const exerciseRows = flattened.flatMap((row) => {
    if (!row.strength) return [];
    const id = byKey.get(row.workoutKey);
    if (!id) return [];
    return flattenStrengthExercises(row.strength, id, allExercises);
  });
  if (exerciseRows.length > 0) {
    await db.insert(planWorkoutExercises).values(exerciseRows);
  }

  console.log(
    `Inserted plan version ${newVersion} (${inserted.id}): ${insertedWorkouts.length} workouts, ${exerciseRows.length} exercise rows.`
  );
  console.log(`Superseded version ${previous.version}.`);
  process.exit(0);
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
