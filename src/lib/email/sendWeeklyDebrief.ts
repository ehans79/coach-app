import { and, gte, inArray, lte } from "drizzle-orm";
import { render } from "@react-email/components";
import { db } from "@/lib/db/client";
import { activities, activityComments, emailReports } from "@/lib/db/schema";
import { getEnv } from "@/lib/env";
import { getZoneAdherenceTrend } from "@/lib/dashboard/queries";
import { formatKm, formatDuration } from "@/lib/format";
import { buildZoneChartUrl } from "./charts";
import { sendEmail } from "./resend";
import {
  WeeklyDebrief,
  type WeeklyDebriefChecklistItem,
  type WeeklyDebriefHighlight,
  type WeeklyDebriefNextSession,
} from "./templates/WeeklyDebrief";
import type { RegenerationResult } from "@/lib/coaching/regeneration";

function formatDateRange(start: string, end: string): string {
  const opts: Intl.DateTimeFormatOptions = { month: "short", day: "numeric" };
  const s = new Date(`${start}T00:00:00Z`).toLocaleDateString("en-GB", opts);
  const e = new Date(`${end}T00:00:00Z`).toLocaleDateString("en-GB", opts);
  return `${s} – ${e}`;
}

/**
 * Sends the weekly debrief right after regeneration finishes (chained, not
 * a separate schedule, per the brief). Builds the email straight from the
 * regeneration result rather than re-deriving everything from scratch.
 */
export async function sendWeeklyDebrief(regen: RegenerationResult): Promise<void> {
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

  const html = await render(
    WeeklyDebrief({
      weekRangeLabel: `Week of ${formatDateRange(assessment.weekStartDate, assessment.weekEndDate)}`,
      weekVerdict: regen.weekVerdict,
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
    })
  );

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
    weekStartDate: assessment.weekStartDate,
    status,
    resendMessageId,
    error,
  });

  if (status === "failed") throw new Error(`Weekly debrief email failed to send: ${error}`);
}
