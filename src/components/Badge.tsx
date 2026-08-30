export type BadgeTone = "good" | "warning" | "serious" | "neutral";

const TONE_STYLES: Record<BadgeTone, { dot: string; bg: string; text: string }> = {
  good: { dot: "var(--status-good)", bg: "var(--status-good-soft)", text: "var(--ink-primary)" },
  warning: { dot: "var(--status-warning)", bg: "var(--status-warning-soft)", text: "var(--ink-primary)" },
  serious: { dot: "var(--status-serious)", bg: "var(--status-serious-soft)", text: "var(--ink-primary)" },
  neutral: { dot: "var(--ink-muted)", bg: "var(--surface-sunken)", text: "var(--ink-primary)" },
};

// Status color never carries meaning alone — a dot plus the label text.
export function Badge({ tone, label }: { tone: BadgeTone; label: string }) {
  const style = TONE_STYLES[tone];
  return (
    <span
      className="inline-flex items-center gap-1.5 rounded-full px-2.5 py-1 text-xs font-medium"
      style={{ backgroundColor: style.bg, color: style.text }}
    >
      <span className="h-1.5 w-1.5 shrink-0 rounded-full" style={{ backgroundColor: style.dot }} />
      {label}
    </span>
  );
}

export function flagToBadge(flag: "none" | "watch" | "correct"): { tone: BadgeTone; label: string } {
  if (flag === "correct") return { tone: "serious", label: "Correct" };
  if (flag === "watch") return { tone: "warning", label: "Watch" };
  return { tone: "good", label: "On target" };
}

// Same flag, phrased as a short hero-headline sentence rather than a badge
// label — the categorical verdict is real (it's the same generated flag),
// just given the prominence Whoop-style headlines call for.
export function flagToVerdict(flag: "none" | "watch" | "correct"): { tone: BadgeTone; headline: string } {
  if (flag === "correct") return { tone: "serious", headline: "Needs a correction" };
  if (flag === "watch") return { tone: "warning", headline: "Worth a watch" };
  return { tone: "good", headline: "On target" };
}

export function adherenceToBadge(adherence: "ok" | "drifted" | "na"): { tone: BadgeTone; label: string } {
  if (adherence === "drifted") return { tone: "serious", label: "Zone drift" };
  if (adherence === "ok") return { tone: "good", label: "Zone adherence ok" };
  return { tone: "neutral", label: "No target zone" };
}
