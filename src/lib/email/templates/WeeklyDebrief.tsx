import { Html, Head, Body, Container, Section, Row, Column, Text, Heading, Hr, Link, Img, Preview } from "@react-email/components";
import { theme } from "@/lib/theme";

const colors = {
  page: theme.page,
  surface: theme.surface,
  border: "#e1e0d9",
  inkPrimary: theme.inkPrimary,
  inkSecondary: theme.inkSecondary,
  inkMuted: theme.inkMuted,
  accent: theme.accentInk, // text-safe (AA) variant — the vivid --accent fails contrast for body-size text on white
  good: "#1f7a45", // darkened from statusGood for text-on-white legibility (AA)
  warning: "#96701f", // darkened from statusWarning for text-on-white legibility (AA)
  serious: "#a15426", // darkened from statusSerious for text-on-white legibility (AA)
};

export interface WeeklyDebriefChecklistItem {
  name: string;
  sport: string;
  completed: boolean;
}

export interface WeeklyDebriefHighlight {
  name: string;
  date: string;
  commentText: string;
  flag: "watch" | "correct";
}

export interface WeeklyDebriefNextSession {
  dayOfWeek: string;
  name: string;
  sport: string;
  distanceLabel: string | null;
  primaryZone: string | null;
}

export type AcwrBand = "low" | "sweet_spot" | "elevated" | "danger" | null;

export interface WeeklyDebriefLoadContext {
  ctl: number;
  atl: number;
  tsb: number;
  ctlRampPerWeek: number;
  acwr: number | null;
  acwrBand: AcwrBand;
  intensityDistribution: { lowPercent: number; moderatePercent: number; highPercent: number };
  loadChartUrl: string | null;
}

export interface WeeklyDebriefFitness {
  vdot: number;
  effortDate: string;
  effortLabel: string;
  sourceLabel: string;
  /** Null when this is the first qualifying effort — nothing to compare against yet. */
  change: { delta: number; previousVdot: number; previousDate: string } | null;
  thresholdPaceLabel: string | null;
  /** Set only when this week's reconciliation actually moved the active zones. */
  zonesUpdated: boolean;
  criticalSpeedPaceLabel: string | null;
}

export interface WeeklyDebriefStrain {
  severity: "elevated" | "high";
  headline: string;
  body: string;
  firedSignals: { label: string; detail: string }[];
}

export interface WeeklyDebriefProps {
  weekRangeLabel: string;
  weekVerdict: string;
  sessionsPlanned: number;
  sessionsCompleted: number;
  totalDistanceLabel: string;
  totalDurationLabel: string;
  checklist: WeeklyDebriefChecklistItem[];
  zoneChartUrl: string | null;
  highlights: WeeklyDebriefHighlight[];
  nextWeekSessions: WeeklyDebriefNextSession[];
  rationale: string;
  dashboardUrl: string;
  loadContext: WeeklyDebriefLoadContext | null;
  fitness: WeeklyDebriefFitness | null;
  strain: WeeklyDebriefStrain | null;
}

function flagColor(flag: "watch" | "correct"): string {
  return flag === "correct" ? colors.serious : colors.warning;
}

function acwrBandLabel(band: AcwrBand): string | null {
  if (band === "low") return "Low";
  if (band === "sweet_spot") return "Sweet spot";
  if (band === "elevated") return "Elevated";
  if (band === "danger") return "High";
  return null;
}

function acwrBandColor(band: AcwrBand): string {
  if (band === "sweet_spot") return colors.good;
  if (band === "danger") return colors.serious;
  if (band === "elevated") return colors.warning;
  return colors.inkMuted;
}

// 0.3 VDOT is roughly 3-4 sec/km of threshold pace at this athlete's level — below
// that, calling it an improvement or a decline would be reading noise (same threshold
// the reconciliation uses before it will version the zones at all).
const VDOT_MEANINGFUL_CHANGE = 0.3;

function fitnessChangeColor(delta: number): string {
  if (delta >= VDOT_MEANINGFUL_CHANGE) return colors.good;
  if (delta <= -VDOT_MEANINGFUL_CHANGE) return colors.warning;
  return colors.inkMuted;
}

function fitnessSentence(fitness: WeeklyDebriefFitness): string {
  const from = `Estimated from your ${fitness.sourceLabel} on ${fitness.effortDate} (${fitness.effortLabel}).`;
  if (!fitness.change) {
    return `${from} This is your first race-quality effort on record, so there's nothing to compare it against yet — the estimate sharpens with each one.`;
  }
  const { delta, previousVdot } = fitness.change;
  if (delta >= VDOT_MEANINGFUL_CHANGE) {
    return `Your estimated fitness improved since the last check, up ${delta.toFixed(1)} from ${previousVdot.toFixed(1)}. ${from}`;
  }
  if (delta <= -VDOT_MEANINGFUL_CHANGE) {
    return `Your estimated fitness came in ${Math.abs(delta).toFixed(1)} below the last check (${previousVdot.toFixed(1)}). One effort doesn't establish a decline — heat, terrain and how hard you actually raced all move this. ${from}`;
  }
  return `Your estimated fitness is level with the last check (${previousVdot.toFixed(1)}). ${from}`;
}

export function WeeklyDebrief(props: WeeklyDebriefProps) {
  return (
    <Html>
      <Head />
      <Preview>{props.weekVerdict}</Preview>
      <Body style={{ backgroundColor: colors.page, fontFamily: "Arial, Helvetica, sans-serif", margin: 0, padding: 0 }}>
        <Container style={{ maxWidth: 560, margin: "0 auto", padding: "24px 16px" }}>
          <Section
            style={{
              backgroundColor: colors.surface,
              borderTop: `1px solid ${colors.border}`,
              borderRight: `1px solid ${colors.border}`,
              borderBottom: `1px solid ${colors.border}`,
              borderLeft: `4px solid ${theme.accent}`,
              borderRadius: 12,
              padding: 24,
              marginBottom: 16,
            }}
          >
            <table role="presentation" cellPadding={0} cellSpacing={0} style={{ marginBottom: 8 }}>
              <tr>
                <td style={{ paddingRight: 6 }}>
                  <div style={{ width: 8, height: 8, borderRadius: "50%", backgroundColor: theme.accent }} />
                </td>
                <td>
                  <Text style={{ fontSize: 12, fontWeight: 700, color: colors.inkMuted, margin: 0, textTransform: "uppercase" }}>
                    {props.weekRangeLabel}
                  </Text>
                </td>
              </tr>
            </table>
            <Heading style={{ fontSize: 26, fontWeight: 800, lineHeight: "1.2", letterSpacing: "-0.01em", color: colors.inkPrimary, margin: 0 }}>
              {props.weekVerdict}
            </Heading>
          </Section>

          {props.strain && (
            <Section
              style={{
                backgroundColor: props.strain.severity === "high" ? "#f8e9de" : "#fbf1de",
                borderTop: `1px solid ${colors.border}`,
                borderRight: `1px solid ${colors.border}`,
                borderBottom: `1px solid ${colors.border}`,
                borderLeft: `4px solid ${props.strain.severity === "high" ? colors.serious : colors.warning}`,
                borderRadius: 12,
                padding: 24,
                marginBottom: 16,
              }}
            >
              <Text
                style={{
                  fontSize: 12,
                  fontWeight: 700,
                  color: colors.inkMuted,
                  margin: "0 0 6px",
                  textTransform: "uppercase",
                }}
              >
                Fatigue check
              </Text>
              <Heading as="h2" style={{ fontSize: 16, fontWeight: 700, color: colors.inkPrimary, margin: "0 0 8px", lineHeight: "1.3" }}>
                {props.strain.headline}
              </Heading>
              <Text style={{ fontSize: 13, color: colors.inkSecondary, margin: "0 0 10px", lineHeight: "1.5" }}>
                {props.strain.body}
              </Text>
              {props.strain.firedSignals.map((s) => (
                <Text key={s.label} style={{ fontSize: 13, color: colors.inkSecondary, margin: "0 0 6px", lineHeight: "1.5" }}>
                  <span style={{ fontWeight: 600, color: colors.inkPrimary }}>{s.label}:</span> {s.detail}
                </Text>
              ))}
            </Section>
          )}

          <Section
            style={{
              backgroundColor: colors.surface,
              border: `1px solid ${colors.border}`,
              borderRadius: 12,
              padding: 24,
              marginBottom: 16,
            }}
          >
            <Heading as="h2" style={{ fontSize: 14, fontWeight: 700, color: colors.inkPrimary, margin: "0 0 12px" }}>
              This week
            </Heading>

            <Row style={{ marginBottom: 16 }}>
              <Column>
                <Text style={{ fontSize: 11, color: colors.inkMuted, margin: 0 }}>Sessions</Text>
                <Text style={{ fontSize: 18, color: colors.inkPrimary, margin: "2px 0 0", fontWeight: 600 }}>
                  {props.sessionsCompleted}/{props.sessionsPlanned}
                </Text>
              </Column>
              <Column>
                <Text style={{ fontSize: 11, color: colors.inkMuted, margin: 0 }}>Distance</Text>
                <Text style={{ fontSize: 18, color: colors.inkPrimary, margin: "2px 0 0", fontWeight: 600 }}>
                  {props.totalDistanceLabel}
                </Text>
              </Column>
              <Column>
                <Text style={{ fontSize: 11, color: colors.inkMuted, margin: 0 }}>Time</Text>
                <Text style={{ fontSize: 18, color: colors.inkPrimary, margin: "2px 0 0", fontWeight: 600 }}>
                  {props.totalDurationLabel}
                </Text>
              </Column>
            </Row>

            {props.checklist.map((item) => (
              <Row key={item.name} style={{ marginBottom: 4 }}>
                <Column>
                  <Text style={{ fontSize: 13, color: colors.inkSecondary, margin: 0 }}>
                    <span style={{ color: item.completed ? colors.good : colors.inkMuted }}>
                      {item.completed ? "✓" : "○"}
                    </span>{" "}
                    {item.name}
                  </Text>
                </Column>
              </Row>
            ))}

            {props.zoneChartUrl && (
              <Img
                src={props.zoneChartUrl}
                width="100%"
                alt="Zone time distribution this week"
                style={{ marginTop: 16, borderRadius: 8 }}
              />
            )}

            {props.highlights.length > 0 && (
              <>
                <Hr style={{ borderColor: colors.border, margin: "16px 0" }} />
                {props.highlights.map((h) => (
                  <Text key={h.name + h.date} style={{ fontSize: 13, color: colors.inkSecondary, margin: "0 0 8px" }}>
                    <span style={{ color: flagColor(h.flag), fontWeight: 600 }}>
                      {h.flag === "correct" ? "Correct: " : "Watch: "}
                    </span>
                    {h.commentText}
                  </Text>
                ))}
              </>
            )}
          </Section>

          {props.loadContext && (
            <Section
              style={{
                backgroundColor: colors.surface,
                border: `1px solid ${colors.border}`,
                borderRadius: 12,
                padding: 24,
                marginBottom: 16,
              }}
            >
              <Heading as="h2" style={{ fontSize: 14, fontWeight: 700, color: colors.inkPrimary, margin: "0 0 12px" }}>
                Training load
              </Heading>

              <Row style={{ marginBottom: 12 }}>
                <Column>
                  <Text style={{ fontSize: 11, color: colors.inkMuted, margin: 0 }}>Fitness (CTL)</Text>
                  <Text style={{ fontSize: 18, color: colors.inkPrimary, margin: "2px 0 0", fontWeight: 600 }}>
                    {props.loadContext.ctl.toFixed(0)}
                  </Text>
                  <Text style={{ fontSize: 11, color: colors.inkMuted, margin: 0 }}>
                    {props.loadContext.ctlRampPerWeek >= 0 ? "+" : ""}
                    {props.loadContext.ctlRampPerWeek.toFixed(1)}/wk
                  </Text>
                </Column>
                <Column>
                  <Text style={{ fontSize: 11, color: colors.inkMuted, margin: 0 }}>Fatigue (ATL)</Text>
                  <Text style={{ fontSize: 18, color: colors.inkPrimary, margin: "2px 0 0", fontWeight: 600 }}>
                    {props.loadContext.atl.toFixed(0)}
                  </Text>
                </Column>
                <Column>
                  <Text style={{ fontSize: 11, color: colors.inkMuted, margin: 0 }}>Form (TSB)</Text>
                  <Text style={{ fontSize: 18, color: colors.inkPrimary, margin: "2px 0 0", fontWeight: 600 }}>
                    {props.loadContext.tsb >= 0 ? "+" : ""}
                    {props.loadContext.tsb.toFixed(0)}
                  </Text>
                </Column>
                {props.loadContext.acwr != null && (
                  <Column>
                    <Text style={{ fontSize: 11, color: colors.inkMuted, margin: 0 }}>ACWR</Text>
                    <Text
                      style={{
                        fontSize: 18,
                        margin: "2px 0 0",
                        fontWeight: 600,
                        color: acwrBandColor(props.loadContext.acwrBand),
                      }}
                    >
                      {props.loadContext.acwr.toFixed(2)}
                    </Text>
                    <Text style={{ fontSize: 11, color: acwrBandColor(props.loadContext.acwrBand), margin: 0 }}>
                      {acwrBandLabel(props.loadContext.acwrBand)}
                    </Text>
                  </Column>
                )}
              </Row>

              <Text style={{ fontSize: 13, color: colors.inkSecondary, margin: "0 0 4px" }}>
                This week: {props.loadContext.intensityDistribution.lowPercent.toFixed(0)}% low ·{" "}
                {props.loadContext.intensityDistribution.moderatePercent.toFixed(0)}% moderate ·{" "}
                {props.loadContext.intensityDistribution.highPercent.toFixed(0)}% high (80/20 target: ~80% low)
              </Text>

              {props.loadContext.loadChartUrl && (
                <Img
                  src={props.loadContext.loadChartUrl}
                  width="100%"
                  alt="CTL/ATL/TSB trend"
                  style={{ marginTop: 12, borderRadius: 8 }}
                />
              )}
            </Section>
          )}

          {props.fitness && (
            <Section
              style={{
                backgroundColor: colors.surface,
                border: `1px solid ${colors.border}`,
                borderRadius: 12,
                padding: 24,
                marginBottom: 16,
              }}
            >
              <Heading as="h2" style={{ fontSize: 14, fontWeight: 700, color: colors.inkPrimary, margin: "0 0 12px" }}>
                Estimated fitness
              </Heading>

              <Row style={{ marginBottom: 12 }}>
                <Column>
                  <Text style={{ fontSize: 11, color: colors.inkMuted, margin: 0 }}>VDOT</Text>
                  <Text style={{ fontSize: 24, color: colors.inkPrimary, margin: "2px 0 0", fontWeight: 700 }}>
                    {props.fitness.vdot.toFixed(1)}
                  </Text>
                  {props.fitness.change && (
                    <Text
                      style={{
                        fontSize: 11,
                        margin: 0,
                        fontWeight: 600,
                        color: fitnessChangeColor(props.fitness.change.delta),
                      }}
                    >
                      {props.fitness.change.delta >= 0 ? "+" : ""}
                      {props.fitness.change.delta.toFixed(1)} since {props.fitness.change.previousDate}
                    </Text>
                  )}
                </Column>
                {props.fitness.thresholdPaceLabel && (
                  <Column>
                    <Text style={{ fontSize: 11, color: colors.inkMuted, margin: 0 }}>Threshold pace</Text>
                    <Text style={{ fontSize: 18, color: colors.inkPrimary, margin: "2px 0 0", fontWeight: 600 }}>
                      {props.fitness.thresholdPaceLabel}
                    </Text>
                  </Column>
                )}
                {props.fitness.criticalSpeedPaceLabel && (
                  <Column>
                    <Text style={{ fontSize: 11, color: colors.inkMuted, margin: 0 }}>Critical Speed</Text>
                    <Text style={{ fontSize: 18, color: colors.inkPrimary, margin: "2px 0 0", fontWeight: 600 }}>
                      {props.fitness.criticalSpeedPaceLabel}
                    </Text>
                  </Column>
                )}
              </Row>

              <Text style={{ fontSize: 13, color: colors.inkSecondary, margin: "0 0 4px", lineHeight: "1.5" }}>
                {fitnessSentence(props.fitness)}
              </Text>
              {props.fitness.zonesUpdated && (
                <Text style={{ fontSize: 12, color: colors.inkMuted, margin: "4px 0 0", lineHeight: "1.5" }}>
                  Your training paces have been updated to match. The new threshold pace applies to runs from here on —
                  past sessions keep the numbers they were scored against.
                </Text>
              )}
            </Section>
          )}

          <Section
            style={{
              backgroundColor: colors.surface,
              border: `1px solid ${colors.border}`,
              borderRadius: 12,
              padding: 24,
              marginBottom: 16,
            }}
          >
            <Heading as="h2" style={{ fontSize: 14, fontWeight: 700, color: colors.inkPrimary, margin: "0 0 12px" }}>
              Next week
            </Heading>
            {props.nextWeekSessions.map((s) => (
              <Row key={s.dayOfWeek + s.name} style={{ marginBottom: 4 }}>
                <Column>
                  <Text style={{ fontSize: 13, color: colors.inkSecondary, margin: 0 }}>
                    <span style={{ color: colors.inkMuted }}>{s.dayOfWeek}:</span> {s.name}
                    {s.distanceLabel ? ` — ${s.distanceLabel}` : ""}
                  </Text>
                </Column>
              </Row>
            ))}
            <Text style={{ fontSize: 13, color: colors.inkSecondary, marginTop: 12, fontStyle: "italic" }}>
              {props.rationale}
            </Text>
          </Section>

          <Text style={{ fontSize: 12, color: colors.inkMuted, textAlign: "center" }}>
            <Link href={props.dashboardUrl} style={{ color: colors.accent }}>
              View the full dashboard
            </Link>
          </Text>
        </Container>
      </Body>
    </Html>
  );
}
