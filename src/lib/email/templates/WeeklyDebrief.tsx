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
}

function flagColor(flag: "watch" | "correct"): string {
  return flag === "correct" ? colors.serious : colors.warning;
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
              border: `1px solid ${colors.border}`,
              borderRadius: 12,
              padding: 24,
              marginBottom: 16,
            }}
          >
            <Text style={{ fontSize: 12, color: colors.inkMuted, margin: 0, textTransform: "uppercase" }}>
              {props.weekRangeLabel}
            </Text>
            <Heading style={{ fontSize: 20, color: colors.inkPrimary, margin: "6px 0 0" }}>
              {props.weekVerdict}
            </Heading>
          </Section>

          <Section
            style={{
              backgroundColor: colors.surface,
              border: `1px solid ${colors.border}`,
              borderRadius: 12,
              padding: 24,
              marginBottom: 16,
            }}
          >
            <Heading as="h2" style={{ fontSize: 14, color: colors.inkPrimary, margin: "0 0 12px" }}>
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

          <Section
            style={{
              backgroundColor: colors.surface,
              border: `1px solid ${colors.border}`,
              borderRadius: 12,
              padding: 24,
              marginBottom: 16,
            }}
          >
            <Heading as="h2" style={{ fontSize: 14, color: colors.inkPrimary, margin: "0 0 12px" }}>
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
