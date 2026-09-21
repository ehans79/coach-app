// Metric-only formatting helpers, per the brief's European/Portugal
// conventions — km/m, kg, °C, min:sec/km. Never surface imperial units.

export function formatKm(meters: number | null | undefined): string {
  if (meters == null) return "—";
  return `${(meters / 1000).toFixed(1)}km`;
}

export function formatDuration(totalSeconds: number | null | undefined): string {
  if (totalSeconds == null) return "—";
  const seconds = Math.round(totalSeconds);
  const h = Math.floor(seconds / 3600);
  const m = Math.floor((seconds % 3600) / 60);
  const s = seconds % 60;
  if (h > 0) return `${h}:${String(m).padStart(2, "0")}:${String(s).padStart(2, "0")}`;
  return `${m}:${String(s).padStart(2, "0")}`;
}

/** secPerKm -> "5:03/km" */
export function formatPace(secPerKm: number | null | undefined): string {
  if (secPerKm == null || !Number.isFinite(secPerKm)) return "—";
  const total = Math.round(secPerKm);
  const m = Math.floor(total / 60);
  const s = total % 60;
  return `${m}:${String(s).padStart(2, "0")}/km`;
}

/** secPerKm -> "5:03" — the same clock as formatPace without the unit, for ranges
 * and axis ticks where repeating "/km" on both ends just adds noise. */
export function formatPaceClock(secPerKm: number | null | undefined): string {
  if (secPerKm == null || !Number.isFinite(secPerKm)) return "—";
  const total = Math.round(secPerKm);
  const m = Math.floor(total / 60);
  const s = total % 60;
  return `${m}:${String(s).padStart(2, "0")}`;
}

/** Seconds -> "2 min" / "20 min" / "1 h" — labels for the best-effort durations. */
export function formatEffortDuration(seconds: number): string {
  if (seconds >= 3600) {
    const hours = seconds / 3600;
    return `${Number.isInteger(hours) ? hours : hours.toFixed(1)} h`;
  }
  return `${Math.round(seconds / 60)} min`;
}

export function formatTempC(tempC: number | null | undefined): string {
  if (tempC == null) return "—";
  return `${Math.round(tempC)}°C`;
}

// ---------------------------------------------------------------------------
// Cadence
//
// Strava's REST API reports running cadence per leg (revolutions per minute,
// typically 67-85 here), while Strava's own UI, Garmin, and every coaching
// convention quote steps per minute counting both feet. Storage keeps Strava's
// raw value so a re-sync stays idempotent and the row always matches the
// source; the doubling happens at the presentation boundary instead — here,
// and in the facts handed to the commentary model so its prose agrees with the
// tiles.
//
// The doubling is sport-dependent and must stay that way: cycling cadence is
// already crank RPM in the API and is displayed undoubled everywhere, so
// doubling a ride would invent a number. Runs, walks and hikes are per-leg.
// ---------------------------------------------------------------------------

const PER_LEG_CADENCE_SPORTS = new Set([
  "Run",
  "TrailRun",
  "VirtualRun",
  "Walk",
  "Hike",
]);

/** True when Strava reports this sport's cadence per leg, so display must double it. */
export function cadenceIsPerLeg(sportType: string | null | undefined): boolean {
  return sportType != null && PER_LEG_CADENCE_SPORTS.has(sportType);
}

/**
 * Strava's stored cadence -> steps per minute, matching what Strava and Garmin
 * show. Non-per-leg sports (cycling) pass through unchanged.
 */
export function toStepsPerMinute(
  cadence: number | null | undefined,
  sportType: string | null | undefined
): number | null {
  if (cadence == null) return null;
  return cadenceIsPerLeg(sportType) ? cadence * 2 : cadence;
}

/** Stored cadence -> "154spm" (or "88rpm" for cycling). */
export function formatCadence(
  cadence: number | null | undefined,
  sportType: string | null | undefined
): string {
  const value = toStepsPerMinute(cadence, sportType);
  if (value == null) return "—";
  return `${Math.round(value)}${cadenceIsPerLeg(sportType) ? "spm" : "rpm"}`;
}
