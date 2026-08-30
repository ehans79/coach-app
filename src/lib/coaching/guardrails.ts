// Hard, deterministic bounds the LLM-generated week must respect — encodes
// the periodization rules from the brief's "Coaching reference logic"
// section. These never go through the LLM; regeneration.ts validates the
// LLM's output against them and clamps anything that oversteps.

// Edu is "strong foundation, returning from a break" per the athlete seed
// data — technically 10-15%/week is allowed, but the brief explicitly flags
// his Aug 2025 shin-issue history as a reason to stay conservative, so use
// the low end of that band rather than the full range.
const MAX_WEEKLY_VOLUME_INCREASE_PERCENT = 10;
const MAX_LONG_RUN_INCREASE_KM = 2.5;
const RECOVERY_WEEK_INTERVAL = 4; // 3 weeks building + 1 recovery week
const RECOVERY_WEEK_VOLUME_CUT_PERCENT = 35; // midpoint of the brief's 30-40% range
const ZONE_DRIFT_VOLUME_CAP_PERCENT = 5;
const LOW_COMPLIANCE_THRESHOLD = 0.7;
const PARTIAL_COMPLIANCE_THRESHOLD = 0.9;

export interface Guardrails {
  isRecoveryWeek: boolean;
  volumeChangePercent: number; // the max allowed change; negative = mandated cut
  maxLongRunIncreaseKm: number;
  allowZone4Plus: boolean;
  targetVolumeKmRange: { min: number; max: number };
  targetLongRunKmRange: { min: number; max: number } | null;
  notes: string[];
}

export function computeGuardrails(params: {
  weekNumber: number; // the upcoming week's number in the plan (1-indexed)
  previousWeekPlannedVolumeKm: number;
  previousWeekActualVolumeKm: number;
  previousWeekComplianceRatio: number; // 0-1
  previousWeekHadZoneDrift: boolean;
  previousLongRunKm: number | null;
}): Guardrails {
  const notes: string[] = [];
  const isRecoveryWeek = params.weekNumber % RECOVERY_WEEK_INTERVAL === 0;

  // Base the next week's volume off what actually happened, not what was
  // merely planned — but don't let one badly-missed week collapse the
  // baseline either.
  const baseline = Math.max(
    params.previousWeekActualVolumeKm,
    params.previousWeekPlannedVolumeKm * 0.5
  );

  let volumeChangePercent = MAX_WEEKLY_VOLUME_INCREASE_PERCENT;

  if (isRecoveryWeek) {
    volumeChangePercent = -RECOVERY_WEEK_VOLUME_CUT_PERCENT;
    notes.push(
      `Week ${params.weekNumber} is a scheduled recovery week — cut volume ~${RECOVERY_WEEK_VOLUME_CUT_PERCENT}%, no Zone 4+ work.`
    );
  } else if (params.previousWeekComplianceRatio < LOW_COMPLIANCE_THRESHOLD) {
    volumeChangePercent = 0;
    notes.push("Compliance was below 70% last week — hold volume flat rather than progressing.");
  } else if (params.previousWeekHadZoneDrift) {
    volumeChangePercent = Math.min(volumeChangePercent, ZONE_DRIFT_VOLUME_CAP_PERCENT);
    notes.push("An easy run drifted into a harder zone last week — cap the volume increase until that's corrected.");
  } else if (params.previousWeekComplianceRatio < PARTIAL_COMPLIANCE_THRESHOLD) {
    volumeChangePercent = Math.min(volumeChangePercent, ZONE_DRIFT_VOLUME_CAP_PERCENT);
    notes.push("Partial compliance last week — keep the volume increase modest.");
  }

  const targetVolumeKm = baseline * (1 + volumeChangePercent / 100);
  const targetVolumeKmRange = isRecoveryWeek
    ? { min: targetVolumeKm * 0.9, max: targetVolumeKm }
    : { min: baseline, max: targetVolumeKm };

  const maxLongRunIncreaseKm = isRecoveryWeek ? 0 : MAX_LONG_RUN_INCREASE_KM;
  const targetLongRunKmRange = params.previousLongRunKm
    ? isRecoveryWeek
      ? { min: params.previousLongRunKm * 0.6, max: params.previousLongRunKm * 0.7 }
      : { min: params.previousLongRunKm, max: params.previousLongRunKm + maxLongRunIncreaseKm }
    : null;

  return {
    isRecoveryWeek,
    volumeChangePercent,
    maxLongRunIncreaseKm,
    allowZone4Plus: !isRecoveryWeek,
    targetVolumeKmRange,
    targetLongRunKmRange,
    notes,
  };
}
