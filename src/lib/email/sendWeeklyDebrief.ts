import { and, asc, gte, inArray, lte } from "drizzle-orm";
import { render } from "@react-email/components";
import { db } from "@/lib/db/client";
import { activities, activityComments, emailReports, dailyLoad } from "@/lib/db/schema";
import { getEnv } from "@/lib/env";
import { getVdotView, getZoneAdherenceTrend } from "@/lib/dashboard/queries";
import { getWeeklyLoadContext } from "@/lib/coaching/commentary";
import { getCoachsReadForWeek } from "@/lib/coaching/coachsRead";
import { assessTrainingStrain } from "@/lib/metrics/strain";
import { getCurrentCriticalSpeed } from "@/lib/metrics/criticalSpeed";
import { formatKm, formatDuration, formatPace } from "@/lib/format";
import { buildZoneChartUrl, buildLoadChartUrl } from "./charts";
import { sendEmail } from "./resend";
import {
  WeeklyDebrief,
  type WeeklyDebriefChecklistItem,
  type WeeklyDebriefHighlight,
  type WeeklyDebriefNextSession,
  type WeeklyDebriefLoadContext,
  type WeeklyDebriefFitness,
  type WeeklyDebriefStrain,
  type AcwrBand,
} from "./templates/WeeklyDebrief";
import type { RegenerationResult } from "@/lib/coaching/regeneration";

const ACWR_SWEET_SPOT_MIN = 0.8;
const ACWR_SWEET_SPOT_MAX = 1.3;
const ACWR_DANGER_THRESHOLD = 1.5;

function classifyAcwrBand(acwr: number | null): AcwrBand {
  if (acwr == null) return null;
  if (acwr > ACWR_DANGER_THRESHOLD) return "danger";
  if (acwr > ACWR_SWEET_SPOT_MAX) return "elevated";
  if (acwr >= ACWR_SWEET_SPOT_MIN) return "sweet_spot";
  return "low";
}

const LOAD_CHART_TRAILING_DAYS = 56; // ~8 weeks

async function buildLoadContext(weekStartDate: string, weekEndDate: string): Promise<WeeklyDebriefLoadContext | null> {
  const current = await getWeeklyLoadContext(weekEndDate);
  if (!current) return null;

  const weekRows = await db
    .select({
      zoneSecondsLow: dailyLoad.zoneSecondsLow,
      zoneSecondsModerate: dailyLoad.zoneSecondsModerate,
      zoneSecondsHigh: dailyLoad.zoneSecondsHigh,
    })
    .from(dailyLoad)
    .where(and(gte(dailyLoad.date, weekStartDate), lte(dailyLoad.date, weekEndDate)));
  const totals = weekRows.reduce(
    (acc, r) => ({
      low: acc.low + r.zoneSecondsLow,
      moderate: acc.moderate + r.zoneSecondsModerate,
      high: acc.high + r.zoneSecondsHigh,
    }),
    { low: 0, moderate: 0, high: 0 }
  );
  const totalSeconds = totals.low + totals.moderate + totals.high;

  const chartSince = new Date(`${weekEndDate}T00:00:00Z`);
  chartSince.setUTCDate(chartSince.getUTCDate() - LOAD_CHART_TRAILING_DAYS);
  const chartRows = await db
    .select({ date: dailyLoad.date, ctl: dailyLoad.ctl, atl: dailyLoad.atl, tsb: dailyLoad.tsb })
    .from(dailyLoad)
    .where(and(gte(dailyLoad.date, chartSince.toISOString().slice(0, 10)), lte(dailyLoad.date, weekEndDate)))
    .orderBy(asc(dailyLoad.date));

  return {
    ctl: current.ctl,
    atl: current.atl,
    tsb: current.tsb,
    ctlRampPerWeek: current.ctlRampPerWeek,
    acwr: current.acwr,
    acwrBand: classifyAcwrBand(current.acwr),
    intensityDistribution: {
      lowPercent: totalSeconds > 0 ? (totals.low / totalSeconds) * 100 : 0,
      moderatePercent: totalSeconds > 0 ? (totals.moderate / totalSeconds) * 100 : 0,
      highPercent: totalSeconds > 0 ? (totals.high / totalSeconds) * 100 : 0,
    },
    loadChartUrl: chartRows.length > 1 ? buildLoadChartUrl(chartRows) : null,
  };
}

/**
 * The fitness block. `zonesUpdated` reads the active constants rather than the
 * reconciliation's return value, since the promotion normally happens during the hourly
 * sync that ran when the race landed, not in this job — so "did the zones move because
 * of this effort?" is the question that survives either path.
 */
async function buildFitness(weekEndDate: string): Promise<WeeklyDebriefFitness | null> {
  const [view, cs] = await Promise.all([getVdotView(), getCurrentCriticalSpeed()]);
  if (!view.current) return null;
  const { current } = view;

  return {
    vdot: current.vdot,
    effortDate: current.effortDate,
    effortLabel: `${current.distanceKm.toFixed(2)}km in ${formatDuration(current.durationSeconds)}`,
    sourceLabel: current.source === "strava_race" ? "race" : "time-trial-quality effort",
    change: view.changeVsPrevious
      ? {
          delta: view.changeVsPrevious.delta,
          previousVdot: view.changeVsPrevious.previousVdot,
          previousDate: view.changeVsPrevious.previousDate,
        }
      : null,
    thresholdPaceLabel: view.activeThreshold ? formatPace(view.activeThreshold.thresholdPaceSecPerKm) : null,
    zonesUpdated: view.activeThreshold?.derivedFromVdot === true && view.activeThreshold.asOfDate <= weekEndDate,
    criticalSpeedPaceLabel: cs ? formatPace(cs.criticalSpeedPaceSecPerKm) : null,
  };
}

async function buildStrain(weekEndDate: string): Promise<WeeklyDebriefStrain | null> {
  const assessment = await assessTrainingStrain(weekEndDate);
  if (!assessment.triggered || assessment.severity === "none") return null;
  return {
    severity: assessment.severity,
    headline: assessment.headline,
    body: assessment.body,
    firedSignals: assessment.signals.filter((s) => s.fired).map((s) => ({ label: s.label, detail: s.detail })),
  };
}

function formatDateRange(start: string, end: string): string {
  const opts: Intl.DateTimeFormatOptions = { month: "short", day: "numeric" };
  const s = new Date(`${start}T00:00:00Z`).toLocaleDateString("en-GB", opts);
  const e = new Date(`${end}T00:00:00Z`).toLocaleDateString("en-GB", opts);
  return `${s} – ${e}`;
}

/**
 * Builds the debrief HTML from a regeneration result. Split out from the send
 * so a test/preview can produce byte-identical email without touching Resend or
 * the email_reports log — the alternative, a script re-assembling these props
 * itself, would be testing something other than what actually ships.
 */
export async function renderWeeklyDebriefHtml(regen: RegenerationResult): Promise<string> {
  const env = getEnv();
  const { assessment, newWeek } = regen;

  const checklist: WeeklyDebriefChecklistItem[] = [
    ...assessment.completedSessions
      .slice()
      .sort((a, b) => a.date.localeCompare(b.date))
      .map((s) => ({ name: s.name, sport: s.sport, completed: true })),
    ...assessment.missedSessions
      .slice()
      .sort((a, b) => a.date.localeCompare(b.date))
      .map((s) => ({ name: s.name, sport: s.sport, completed: false })),
  ];

  const zoneTrend = await getZoneAdherenceTrend();
  const weekZone = zoneTrend.find((z) => z.weekStart === assessment.weekStartDate);
  const zoneChartUrl = weekZone
    ? buildZoneChartUrl([weekZone.zone1, weekZone.zone2, weekZone.zone3, weekZone.zone4, weekZone.zone5])
    : null;

  const rangeStart = new Date(`${assessment.weekStartDate}T00:00:00Z`);
  const rangeEnd = new Date(`${assessment.weekEndDate}T23:59:59Z`);
  const weekActivities = await db
    .select()
    .from(activities)
    .where(and(gte(activities.startDateLocal, rangeStart), lte(activities.startDateLocal, rangeEnd)));
  const activityIds = weekActivities.map((a) => a.id);
  const comments =
    activityIds.length > 0
      ? await db.select().from(activityComments).where(inArray(activityComments.activityId, activityIds))
      : [];
  const highlights: WeeklyDebriefHighlight[] = comments
    .filter((c) => c.flag !== "none")
    .map((c) => {
      const activity = weekActivities.find((a) => a.id === c.activityId);
      return {
        name: activity?.name ?? "Activity",
        date: activity ? activity.startDateLocal.toISOString().slice(0, 10) : "",
        commentText: c.commentText,
        flag: c.flag as "watch" | "correct",
      };
    });

  const nextWeekSessions: WeeklyDebriefNextSession[] = newWeek.days
    .flatMap((day) => day.workouts.map((w) => ({ day, w })))
    .filter(({ w }) => w.sport !== "rest")
    .map(({ day, w }) => ({
      dayOfWeek: day.dayOfWeek,
      name: w.name,
      sport: w.sport,
      distanceLabel: w.distanceMeters ? formatKm(w.distanceMeters) : null,
      primaryZone: w.primaryZone ?? null,
    }));

  // Read, not generated, on purpose: the Sunday job writes the coach's read once
  // and both this email and the Trends dashboard render that same text. If the
  // generation step failed, the email opens without it rather than prompting for
  // a second, subtly different synthesis of the same week.
  const [loadContext, fitness, strain, coachsRead] = await Promise.all([
    buildLoadContext(assessment.weekStartDate, assessment.weekEndDate),
    buildFitness(assessment.weekEndDate),
    buildStrain(assessment.weekEndDate),
    getCoachsReadForWeek(assessment.weekStartDate),
  ]);

  return render(
    WeeklyDebrief({
      weekRangeLabel: `Week of ${formatDateRange(assessment.weekStartDate, assessment.weekEndDate)}`,
      weekVerdict: regen.weekVerdict,
      coachsRead: coachsRead?.summaryText ?? null,
      sessionsPlanned: assessment.sessionsPlanned,
      sessionsCompleted: assessment.sessionsCompleted,
      totalDistanceLabel: formatKm(assessment.actualRunVolumeKm * 1000),
      totalDurationLabel: formatDuration(assessment.actualRunDurationSeconds),
      checklist,
      zoneChartUrl,
      highlights,
      nextWeekSessions,
      rationale: regen.rationale,
      dashboardUrl: env.APP_BASE_URL,
      loadContext,
      fitness,
      strain,
    })
  );
}

/**
 * Sends the weekly debrief right after regeneration finishes (chained, not
 * a separate schedule, per the brief). Builds the email straight from the
 * regeneration result rather than re-deriving everything from scratch.
 */
export async function sendWeeklyDebrief(regen: RegenerationResult): Promise<void> {
  const env = getEnv();
  const html = await renderWeeklyDebriefHtml(regen);

  let status: "sent" | "failed" = "sent";
  let resendMessageId: string | null = null;
  let error: string | null = null;
  try {
    const result = await sendEmail({
      to: env.NOTIFY_EMAIL,
      subject: `Weekly debrief: ${regen.weekVerdict}`,
      html,
    });
    resendMessageId = result.id;
  } catch (err) {
    status = "failed";
    error = err instanceof Error ? err.message : String(err);
  }

  await db.insert(emailReports).values({
    planId: regen.planId,
    weekStartDate: regen.assessment.weekStartDate,
    status,
    resendMessageId,
    error,
  });

  if (status === "failed") throw new Error(`Weekly debrief email failed to send: ${error}`);
}
