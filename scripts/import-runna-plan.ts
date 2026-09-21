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
 * Zone 3 "drift", and cutting volume further each Sunday in response.
 *
 * Runna owns the structure (which day, which session, how far, at what pace).
 * This app owns what Runna doesn't give him: heart-rate context read against
 * his own data, execution coaching, the two gym sessions, and the weekly
 * debrief. See ExternalPlanSource in src/lib/coaching/plan.ts — the Sunday
 * regeneration job reads that skeleton and cannot rewrite the structure.
 *
 * Sources:
 *  - "Functional Fitness Plan Overview.pdf" (Runna export, 2026-09-07) for
 *    the 8-week grid: day, session name, headline distance.
 *  - Rep-by-rep detail for weeks 3-8, supplied by Edu from the Runna app.
 *    Every session's steps below sum to the PDF's headline distance, which is
 *    asserted at build time (see assertDistances).
 *
 * Weeks 1-2 are already run and no rep detail was supplied for them, so they
 * carry the grid-level prescription only and are flagged repDetail: false.
 *
 * Run with: npx tsx scripts/import-runna-plan.ts [--dry-run]
 */

const DRY_RUN = process.argv.includes("--dry-run");

const PROVIDER = "Runna";
const PLAN_NAME = "8 Week Functional Fitness Plan";
const SOURCE_DOCUMENT =
  "Functional Fitness Plan Overview.pdf (Runna export, 2026-09-07) + per-session rep detail from the Runna app";
const RACE_DATE = "2026-11-01";
const IMPORTED_AT = new Date().toISOString();

// ---------------------------------------------------------------------------
// Heart-rate context
//
// HRmax (195) is athlete-provided and exact. The pace zones in the DB derive
// from a 35:00 5K that predates the layoff and are stale — Runna is asking for
// reps at 6:05/km and faster, which that table calls Zone 5 and beyond.
//
// So Runna's paces are the target and HR is the read-out, not the ceiling.
// The exception is the genuinely conversational running (the Friday easy runs
// and the warm-up/cool-down segments), where HR is the better guide because
// there is no pace to chase.
//
// The bands below are estimated from Edu's own September runs, not from the
// stale table: 7:04/km ran 143bpm, 6:33/km ran 158bpm, 6:42/km ran 164bpm.
// They are deliberately quoted as expectations to sanity-check against, and
// will tighten as the block produces more data.
// ---------------------------------------------------------------------------
const HR_NOTE_EASY =
  "Heart rate is the guide here, not pace: keep it under 156bpm. If it drifts above, ease off until it settles back under ~145bpm.";
const HR_NOTE_PACED =
  "Run to Runna's pace and let heart rate land where it lands — on these segments Zone 3 is the intent, not a mistake. Expect roughly 160-170bpm at 6:45/km and 170-180bpm at 6:10/km, based on your September runs. Back off only if it is pinned above ~185bpm while the pace is still slipping.";
const HR_NOTE_REPS =
  "Chase the pace on the reps and take the walking rests properly — walk them, don't jog them, and let heart rate come most of the way down before the next rep. Expect to be in Zone 4 and above on the fast segments; that is the point of the session.";

const ZONE_EASY = "Zone 1-2 (HR <156bpm)";
const ZONE_STEADY = "Zone 2-3 (HR 126-171bpm)";
const ZONE_THRESHOLD = "Zone 3-4 (HR 157-186bpm)";
const ZONE_INTERVAL = "Zone 4-5 (HR 172bpm+)";
const ZONE_STRENGTH = "N/A (strength)";

const CONVERSATIONAL_PACE = "roughly 7:00-7:45/km for you";

// ---------------------------------------------------------------------------
// The Runna plan
// ---------------------------------------------------------------------------

type Step =
  | { run: number; pace?: string; effort?: "conversational" | "comfortable"; note?: string }
  | { rest: number };

function isRun(s: Step): s is Extract<Step, { run: number }> {
  return "run" in s;
}

interface RunnaSession {
  label: string;
  type: "intervals" | "tempo" | "easy" | "long" | "race";
  km: number; // the PDF's headline distance, asserted against the steps
  zone: string;
  hrNote: string;
  /** Absent for weeks 1-2, where only the grid-level prescription is known. */
  steps?: Step[];
  /** Coaching this app adds on top of Runna's prescription. */
  coach?: string;
}

interface RunnaWeek {
  weekNumber: number;
  startDate: string;
  tuesday: RunnaSession;
  friday: RunnaSession;
  sunday: RunnaSession;
}

const EASY_3KM = (km: number): RunnaSession => ({
  label: "Easy Run",
  type: "easy",
  km,
  zone: ZONE_EASY,
  hrNote: HR_NOTE_EASY,
  steps: [{ run: km * 1000, effort: "conversational" }],
  coach:
    "The only genuinely easy run in your week. It exists to add aerobic volume without adding fatigue, so resist turning it into a third quality session — that is what would break this block, not the mileage.",
});

const RUNNA_WEEKS: RunnaWeek[] = [
  {
    weekNumber: 1,
    startDate: "2026-09-07",
    tuesday: { label: "Drop Set", type: "intervals", km: 3, zone: ZONE_INTERVAL, hrNote: HR_NOTE_REPS },
    friday: { label: "Easy Run", type: "easy", km: 3, zone: ZONE_EASY, hrNote: HR_NOTE_EASY },
    sunday: { label: "Long Run", type: "long", km: 4, zone: ZONE_STEADY, hrNote: HR_NOTE_PACED },
  },
  {
    weekNumber: 2,
    startDate: "2026-09-14",
    tuesday: { label: "On and Offs", type: "intervals", km: 4, zone: ZONE_INTERVAL, hrNote: HR_NOTE_REPS },
    friday: { label: "Easy Run", type: "easy", km: 4, zone: ZONE_EASY, hrNote: HR_NOTE_EASY },
    sunday: { label: "Long Run", type: "long", km: 5, zone: ZONE_STEADY, hrNote: HR_NOTE_PACED },
  },
  {
    weekNumber: 3,
    startDate: "2026-09-21",
    tuesday: {
      label: "Extended Kms",
      type: "tempo",
      km: 5,
      zone: ZONE_THRESHOLD,
      hrNote: HR_NOTE_REPS,
      steps: [
        { run: 1000, effort: "conversational" },
        { rest: 60 },
        { run: 1000, pace: "6:05/km" },
        { rest: 60 },
        { run: 500, pace: "5:50/km" },
        { rest: 60 },
        { run: 1000, pace: "6:05/km" },
        { rest: 60 },
        { run: 500, pace: "5:50/km" },
        { rest: 60 },
        { run: 1000, effort: "conversational" },
      ],
      coach:
        "First real threshold session of the block, and the paces are a step up from anything you have run since coming back — your quickest September kilometre averaged 6:33. Run the first 1km rep at 6:05 and see how it sits before committing to the second. If the 5:50 halves are falling apart, hold 6:00 and keep the rep count; finishing all four reps at a controlled pace beats hitting two and dying.",
    },
    friday: EASY_3KM(3),
    sunday: {
      label: "Long Run",
      type: "long",
      km: 6,
      zone: ZONE_STEADY,
      hrNote: HR_NOTE_PACED,
      steps: [
        { run: 1000, effort: "comfortable" },
        { run: 5000, pace: "6:45/km" },
      ],
      coach:
        "Worth knowing: this is the same prescription you ran on 20 September, where you averaged 6:42/km. You hit it almost exactly. The only change is an extra kilometre of comfortable running on the front, so treat the 5km block as a repeat of a session you have already proved you can execute.",
    },
  },
  {
    weekNumber: 4,
    startDate: "2026-09-28",
    tuesday: {
      label: "Mile Repeats",
      type: "intervals",
      km: 4,
      zone: ZONE_THRESHOLD,
      hrNote: HR_NOTE_REPS,
      steps: [
        { run: 1600, effort: "conversational" },
        { rest: 60 },
        { run: 1600, pace: "6:15/km" },
        { rest: 120 },
        { run: 800, effort: "conversational" },
      ],
      coach:
        "One long rep rather than several short ones, so the discipline is in the first 400m: 6:15/km will feel comfortable for two minutes and honest by the end. Go out at 6:20 and let it come to you rather than banking time early.",
    },
    friday: EASY_3KM(3),
    sunday: {
      label: "Long Run",
      type: "long",
      km: 5,
      zone: ZONE_STEADY,
      hrNote: HR_NOTE_PACED,
      steps: [{ run: 5000, pace: "6:45/km" }],
      coach:
        "Down week, and Runna has dropped the warm-up kilometre — you start at 6:45/km from the first step. Give yourself a few minutes of walking beforehand so the opening kilometre is not the hardest one.",
    },
  },
  {
    weekNumber: 5,
    startDate: "2026-10-05",
    tuesday: {
      label: "Tempo 2k",
      type: "tempo",
      km: 5,
      zone: ZONE_THRESHOLD,
      hrNote: HR_NOTE_REPS,
      steps: [
        { run: 2000, effort: "conversational" },
        { run: 2000, pace: "6:05/km" },
        { rest: 120 },
        { run: 1000, effort: "conversational" },
      ],
      coach:
        "Note there is no rest before the tempo block — you roll straight from the warm-up into 2km at 6:05/km. That continuous 2km is harder than the same pace broken into reps, so settle into rhythm in the first 200m rather than surging into it.",
    },
    friday: EASY_3KM(4),
    sunday: {
      label: "Long Run",
      type: "long",
      km: 7,
      zone: ZONE_STEADY,
      hrNote: HR_NOTE_PACED,
      steps: [
        { run: 1000, effort: "comfortable" },
        { run: 5000, pace: "6:30/km" },
        { run: 1000, effort: "comfortable" },
      ],
      coach:
        "Same shape as week 3's long run but 15 seconds per kilometre quicker through the middle. The cool-down kilometre is part of the session, not optional — run it, don't stop at 6km.",
    },
  },
  {
    weekNumber: 6,
    startDate: "2026-10-12",
    tuesday: {
      label: "Progressive Mile Repeats",
      type: "intervals",
      km: 5,
      zone: ZONE_INTERVAL,
      hrNote: HR_NOTE_REPS,
      steps: [
        { run: 1000, effort: "conversational" },
        { rest: 90 },
        { run: 400, pace: "6:45/km" },
        { run: 400, pace: "6:15/km" },
        { run: 400, pace: "6:00/km" },
        { run: 400, pace: "5:45/km" },
        { rest: 120 },
        { run: 400, pace: "6:45/km" },
        { run: 400, pace: "6:15/km" },
        { run: 400, pace: "6:00/km" },
        { run: 400, pace: "5:45/km" },
        { rest: 120 },
        { run: 800, effort: "conversational" },
      ],
      coach:
        "Two continuous miles that get faster every 400m, with no break inside each mile. The trap is starting the 6:45 segment too quick and having nothing left for the 5:45 — that first quarter should feel almost slow. Getting the last 400m of each mile right is the whole session.",
    },
    friday: EASY_3KM(5),
    sunday: {
      label: "Long Run",
      type: "long",
      km: 8,
      zone: ZONE_THRESHOLD,
      hrNote: HR_NOTE_PACED,
      steps: [
        { run: 4000, pace: "6:40/km" },
        { run: 4000, pace: "6:10/km" },
      ],
      coach:
        "The biggest session of the block, and not really a long run — it is a progression run with a 4km finish at close to race pace, on the longest distance you will cover before the race. Do not let the first half creep under 6:40 because it feels easy; the session is won or lost in the second half.",
    },
  },
  {
    weekNumber: 7,
    startDate: "2026-10-19",
    tuesday: {
      label: "Shorter Intervals",
      type: "intervals",
      km: 6.2,
      zone: ZONE_INTERVAL,
      hrNote: HR_NOTE_REPS,
      steps: [
        { run: 1000, effort: "conversational" },
        { rest: 60 },
        { run: 800, pace: "5:40/km" },
        { rest: 120 },
        { run: 800, pace: "5:40/km" },
        { rest: 120 },
        { run: 400, pace: "5:25/km" },
        { rest: 90 },
        { run: 400, pace: "5:25/km" },
        { rest: 90 },
        { run: 400, pace: "5:25/km" },
        { rest: 90 },
        { run: 400, pace: "5:25/km" },
        { rest: 150, },
        { run: 200, pace: "5:10/km" },
        { rest: 40 },
        { run: 200, pace: "5:10/km" },
        { rest: 40 },
        { run: 200, pace: "5:10/km" },
        { rest: 40 },
        { run: 200, pace: "5:10/km" },
        { rest: 40 },
        { run: 200, pace: "5:10/km" },
        { rest: 40 },
        { run: 1000, effort: "conversational" },
      ],
      coach:
        "Longest and fastest session of the block, and the only one where you touch 5:10/km. These are short reps, so the paces are less outlandish than they look next to your current 5km fitness — but if the 200s are not happening, hold 5:20 and keep all five rather than hitting two and stopping. Runna shows a 90-second and a 60-second break back to back before the 200s; treat that as one break of about two and a half minutes.",
    },
    friday: EASY_3KM(3),
    sunday: {
      label: "Long Run",
      type: "long",
      km: 7,
      zone: ZONE_THRESHOLD,
      hrNote: HR_NOTE_PACED,
      steps: [
        { run: 3000, pace: "6:30/km" },
        { run: 2000, pace: "5:55/km" },
        { run: 2000, pace: "6:30/km" },
      ],
      coach:
        "A fast 2km sandwiched inside steady running, which is a harder ask than it reads — the last 2km back at 6:30 on tired legs is the part that matters. This is your dress rehearsal for holding form when the race gets uncomfortable.",
    },
  },
  {
    weekNumber: 8,
    startDate: "2026-10-26",
    tuesday: {
      label: "Race Pace Practice K's",
      type: "intervals",
      km: 5,
      zone: ZONE_THRESHOLD,
      hrNote: HR_NOTE_REPS,
      steps: [
        { run: 1000, effort: "conversational" },
        { rest: 60 },
        { run: 1000, pace: "6:10/km" },
        { rest: 120 },
        { run: 1000, pace: "6:10/km" },
        { rest: 120 },
        { run: 1000, pace: "6:10/km" },
        { rest: 120 },
        { run: 1000, effort: "conversational" },
      ],
      coach:
        "This is the session that tells you your race pace. 6:10/km is what Runna is aiming you at for Sunday, which over 8km is about 49 minutes. Pay attention to how the third rep feels — if it is comfortable, 6:10 is right; if you are straining, start the race at 6:20 and earn the rest.",
    },
    friday: EASY_3KM(3),
    sunday: {
      label: "8km Race",
      type: "race",
      km: 8,
      zone: ZONE_THRESHOLD,
      hrNote:
        "No heart-rate ceiling today. Expect Zone 3 early and Zone 4 through the back half — that is a correctly-run race.",
      steps: [{ run: 8000, note: "Race" }],
      coach:
        "Warm up with about 10 minutes of easy jogging and a few short strides. Go out at the pace Tuesday told you, not faster — the first kilometre always feels too easy and that is exactly right. Hold it through the middle, then spend whatever is left over the last kilometre.",
    },
  },
];

const WEEK_FOCUS: Record<number, string> = {
  1: "Plan start — re-establishing the three-run rhythm.",
  2: "Second build week, first proper interval session.",
  3: "Threshold work arrives: reps at 6:05 and 5:50, and a 6km paced long run.",
  4: "Down week on volume. One long mile rep, and the long run drops back to 5km.",
  5: "A continuous 2km tempo block and the long run quickens to 6:30/km.",
  6: "Peak week. Progressive mile repeats and an 8km progression run finishing at 6:10/km.",
  7: "Sharpening — the fastest reps of the block, down to 5:10/km.",
  8: "Race week. Rehearse race pace Tuesday, then the 8km on Sunday.",
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

/** Guards the transcription: every session's steps must sum to the PDF's headline distance. */
function assertDistances(): void {
  for (const week of RUNNA_WEEKS) {
    for (const session of [week.tuesday, week.friday, week.sunday]) {
      if (!session.steps) continue;
      const summed = session.steps.filter(isRun).reduce((s, x) => s + x.run, 0);
      const expected = Math.round(session.km * 1000);
      if (summed !== expected) {
        throw new Error(
          `Week ${week.weekNumber} "${session.label}": steps sum to ${summed}m but the Runna overview says ${expected}m.`
        );
      }
    }
  }
}

function formatRest(seconds: number): string {
  return seconds >= 120 && seconds % 60 === 0 ? `${seconds / 60}min walking rest` : `${seconds}s walking rest`;
}

function formatDistance(meters: number): string {
  return meters >= 1000 ? `${(meters / 1000).toFixed(meters % 1000 === 0 ? 0 : 1)}km` : `${meters}m`;
}

function renderSteps(steps: Step[]): string {
  return steps
    .map((step) => {
      if (!isRun(step)) return `  - ${formatRest(step.rest)}`;
      const target = step.pace
        ? `at ${step.pace}`
        : step.effort === "comfortable"
          ? `at a comfortable pace (${CONVERSATIONAL_PACE})`
          : step.effort === "conversational"
            ? `at a conversational pace (${CONVERSATIONAL_PACE})`
            : "";
      return `  - ${formatDistance(step.run)} ${target}`.trimEnd();
    })
    .join("\n");
}

function sessionText(session: RunnaSession): string {
  const parts: string[] = [];
  parts.push(`${PROVIDER} session: "${session.label}", ${session.km}km total.`);

  if (session.steps) {
    parts.push("", renderSteps(session.steps));
  } else {
    parts.push(
      "",
      `Rep detail for this week was not supplied — run it as Runna gives it to you in the app.`
    );
  }

  parts.push("", session.hrNote);
  if (session.coach) parts.push("", session.coach);
  return parts.join("\n");
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
    id: "",
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

    if (dayName === "Monday" || dayName === "Thursday") {
      const slot = dayName === "Monday" ? "A" : "B";
      const workout = strengthWorkout(week.weekNumber, slot);
      workouts.push(workout);
      sessions.push({
        sport: "strength",
        type: workout.type,
        label: workout.name,
        durationMinutes: workout.durationMinutes,
        primaryZone: ZONE_STRENGTH,
        addedByApp: true,
        note: "Runna prescribes rest from running here; the gym session is this app's addition.",
      });
    } else if (dayName === "Tuesday" || dayName === "Friday" || dayName === "Sunday") {
      const session =
        dayName === "Tuesday" ? week.tuesday : dayName === "Friday" ? week.friday : week.sunday;
      const text = sessionText(session);
      workouts.push({
        id: "",
        sport: "run",
        type: session.type,
        name: session.type === "race" ? session.label : `${session.label} (${PROVIDER})`,
        description: text,
        distanceMeters: Math.round(session.km * 1000),
        primaryZone: session.zone,
        humanReadable: text,
        completed: false,
      });
      sessions.push({
        sport: "run",
        type: session.type,
        label: session.label,
        distanceMeters: Math.round(session.km * 1000),
        primaryZone: session.zone,
        note: session.steps
          ? `${PROVIDER} prescribes this session; day, distance, rep structure and paces are fixed.`
          : `${PROVIDER} prescribes this session; rep detail was not supplied for this week.`,
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
    targetHours: Math.round(((runKm * 7.2) / 60 + 2 * 0.58) * 10) / 10,
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

const RATIONALE = `Rebuilt against the Runna "8 Week Functional Fitness Plan" you started on 7 September, now including Runna's rep-by-rep detail for weeks 3 to 8. Until this import the app knew nothing about that plan: it believed you were restarting from a nine-week layoff, so it prescribed 2.5km run/walk intervals under a 156bpm ceiling, scored every Runna session as a missed workout plus a Zone 3 drift, and cut your volume a further 35% in response. Runna now owns the structure through race day on 1 November and the Sunday job can no longer overwrite it.

The rep detail corrected something this app had wrong, and had had wrong for weeks. Runna's Sunday sessions are not easy runs — they are paced. Week 3 asks for 5km at 6:45/km, week 6 for a progression run finishing 4km at 6:10/km. Your 20 September long run averaged 6:42/km at 164bpm, which the app flagged as a Zone 3 drift needing correction. It was not drift. It was the prescription, executed almost exactly. The same is true of 13 September. Both sessions have been re-assessed against what was actually asked of you.

So the Zone 2 ceiling now applies only where Runna genuinely asks for conversational running: the Friday easy runs, and the warm-up and cool-down segments inside the quality sessions. Everywhere else the target is Runna's pace and heart rate is the read-out rather than the limit, with expected ranges estimated from your own September runs rather than the stale pace table.

What the data does say: you have completed five of the six prescribed sessions, missing only Friday 18 September, and cadence has climbed from 73 to 77 spm. The thing worth watching is not intensity discipline but the pace step-up — Runna is asking for 6:05/km reps this week and 5:10/km in week 7, against a quickest September kilometre of 6:33. Each quality session below says what to do if the prescribed pace is not there on the day, which in every case is to hold the rep count and give up the pace, not the reverse.

Gym stays on Monday and Thursday, same movement patterns throughout, progressing by adding a round rather than load, dropping to mobility only in race week.`;

async function main() {
  assertDistances();
  console.log("Verified every session's steps against the Runna overview distances.");

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

  const built = RUNNA_WEEKS.map(buildWeek);
  const weeks = built.map((b) => b.planWeek);
  const skeleton = built.map((b) => b.skeleton);

  const [currentZones] = await db
    .select()
    .from(zoneVersions)
    .where(eq(zoneVersions.isCurrent, true))
    .orderBy(desc(zoneVersions.asOfDate))
    .limit(1);

  const [previous] = await db.select().from(plans).where(eq(plans.isActive, true)).limit(1);
  if (!previous) throw new Error("No active plan to supersede — is the DB seeded?");
  const previousJson = previous.planJson as PlanDocument;

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
          "Back to running three times a week since 2026-09-07 on a Runna plan. Five of six prescribed sessions completed in the first two weeks (missed Friday 2026-09-18). Long runs executed on prescribed pace: 2026-09-20 asked for ~6:45/km and ran 6:42/km. Cadence improving, 73 to 77 spm. CTL ~13.6, ACWR ~1.18 as of 2026-09-20.",
      },
      strengths: [
        {
          sport: "run",
          evidence:
            "Five of six Runna sessions completed in the first fortnight back, and the paced long runs hit their targets almost exactly.",
        },
        { sport: "run", evidence: "Cadence rose from 73 to 77 spm across the first two weeks of the block." },
      ],
      limiters: [
        {
          sport: "run",
          evidence:
            "Runna's prescribed paces step up sharply through the block — 6:05/km reps in week 3 and 5:10/km in week 7, against a quickest September kilometre of 6:33/km. Pace, not intensity discipline, is the risk to manage.",
        },
        {
          sport: "run",
          evidence:
            "Pace zones derive from a 35:00 5K predating the layoff and are stale — they classify Runna's prescribed rep paces as Zone 5 and beyond. Unusable for prescription until a fresh time trial or qualifying effort updates them.",
        },
        {
          sport: "run",
          evidence:
            "Strava history shows a lower-leg (shin) issue and recovery block in Aug 2025 — a reason to hold the Friday easy run genuinely easy, since it is now the only easy running in the week.",
        },
      ],
      constraints: [
        "Running days are fixed by Runna: Tuesday (quality), Friday (easy), Sunday (long).",
        "Gym on Monday and Thursday — this app's addition, on Runna's rest-from-running days.",
        "Race: 8km on 2026-11-01, target pace ~6:10/km per week 8's race-pace session.",
        "Runna owns session structure, distance and pace; this app owns heart-rate context, execution coaching, strength and commentary.",
        "Only the Friday easy runs and the warm-up/cool-down segments are genuinely Zone 2 — the Sunday long runs are paced sessions, not easy runs.",
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
              source: `${currentZones.source} — STALE, derived from a 35:00 5K predating the 2026 layoff. Runna's prescribed paces supersede it.`,
              zones: currentZones.paceZones as PlanDocument["zones"]["run"]["pace"]["zones"],
            },
            note: "HRmax 195 is athlete-provided and exact, so HR zones are sound. The pace table is not: it classifies Runna's prescribed rep paces as Zone 5+. Prescribe to Runna's paces and read HR as a result, except on conversational running where the 156bpm ceiling applies.",
          },
        }
      : previousJson.zones,
    externalPlan: {
      provider: PROVIDER,
      planName: PLAN_NAME,
      importedAt: IMPORTED_AT,
      sourceDocument: SOURCE_DOCUMENT,
      note:
        "Structure and paces (day, session, distance, rep breakdown, target pace) are fixed by Runna through race day. The Sunday regeneration job may only write heart-rate context, execution coaching, strength detail and rationale on top. Weeks 1-2 carry grid-level detail only; weeks 3-8 carry Runna's full rep breakdown.",
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
        focus: "Introduce threshold reps and lift the long run from 6:45/km toward 6:30/km.",
        keyWorkouts: ["Extended Kms", "Mile Repeats", "Tempo 2k"],
      },
      {
        name: "peak",
        startWeek: 6,
        endWeek: 7,
        focus: "Peak volume and the fastest running of the block, down to 5:10/km.",
        keyWorkouts: ["Progressive Mile Repeats", "8km progression run", "Shorter Intervals"],
      },
      {
        name: "taper",
        startWeek: 8,
        endWeek: 8,
        focus: "Rehearse 6:10/km race pace, then race the 8km on 1 November.",
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
    console.log("--dry-run: nothing written.\n");
    console.log(flattened.find((r) => r.date === "2026-09-22")?.humanReadable);
    process.exit(0);
  }

  const newVersion = previous.version + 1;
  const [inserted] = await db
    .insert(plans)
    .values({
      version: newVersion,
      weekStartDate: "2026-09-21",
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
