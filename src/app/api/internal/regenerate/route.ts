import { NextRequest, NextResponse } from "next/server";
import { getEnv } from "@/lib/env";
import { regeneratePlanForNextWeek } from "@/lib/coaching/regeneration";
import { generateCoachsRead, type CoachsRead } from "@/lib/coaching/coachsRead";
import { sendWeeklyDebrief } from "@/lib/email/sendWeeklyDebrief";

/**
 * Manual/test trigger for plan regeneration — the Sunday cron job normally
 * calls regeneratePlanForNextWeek() directly via scripts/cron-weekly.ts,
 * but this lets it be triggered over HTTP (testing, or a future "regenerate
 * now" dashboard action). Optional JSON body: { "date": "YYYY-MM-DD" } to
 * simulate a specific "today", and { "sendEmail": true } to also send the
 * weekly debrief for the regenerated result (testing the full chain).
 *
 * Mirrors the cron's chain, coach's read included — the email reads that text
 * from the DB, so skipping it here would silently send a debrief missing its
 * opening paragraph.
 */
export async function POST(request: NextRequest) {
  const env = getEnv();
  const authHeader = request.headers.get("authorization");
  if (authHeader !== `Bearer ${env.INTERNAL_API_TOKEN}`) {
    return new NextResponse("Unauthorized", { status: 401 });
  }

  const body = await request.json().catch(() => ({}));
  const today = typeof body?.date === "string" ? body.date : new Date().toISOString().slice(0, 10);

  const result = await regeneratePlanForNextWeek(today);

  // Non-fatal, as in the cron: losing the opening paragraph shouldn't fail a
  // regeneration that otherwise succeeded.
  let coachsRead: CoachsRead | null = null;
  try {
    coachsRead = await generateCoachsRead(result.assessment.weekStartDate, result.assessment.weekEndDate);
  } catch (err) {
    console.error("Failed to generate the coach's read — continuing without it", err);
  }

  if (body?.sendEmail === true) {
    await sendWeeklyDebrief(result);
  }

  return NextResponse.json({ ...result, coachsRead });
}
