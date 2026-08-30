// Single hex source of truth for the visual system — the dashboard reads
// these via CSS custom properties in globals.css (kept in sync with this
// file by hand, since CSS can't import TS), while Recharts (chartColors.ts)
// and the weekly email (which can't read CSS vars or run JS) import this
// module directly. Change a color here, then mirror the same hex into the
// :root block in globals.css.
export const theme = {
  page: "#f6f5f1",
  surface: "#ffffff",
  surfaceSunken: "#f0efe9",
  inkPrimary: "#0a0a0a",
  inkSecondary: "#4b4a45",
  inkMuted: "#8b8a83",
  border: "rgba(10, 10, 10, 0.08)",
  borderStrong: "rgba(10, 10, 10, 0.14)",

  // Brand accent ("Ember") — used deliberately (nav, primary actions, hero
  // numbers), never as a status or series color.
  accent: "#ff4433",
  accentSoft: "#ffe3dc",
  accentInk: "#d6371f", // AA-contrast variant for text on light backgrounds

  // Celebration accent ("Volt") — streaks/milestones only, never body text.
  celebrate: "#b6f23c",
  celebrateInk: "#1a1a1a",

  // Status ramp — deliberately muted relative to the accent so the two are
  // never confused; always paired with a label, never color alone.
  statusGood: "#2e9e5b",
  statusGoodSoft: "#e4f5ea",
  statusWarning: "#d9a441",
  statusWarningSoft: "#fbf1de",
  statusSerious: "#c97a4a",
  statusSeriousSoft: "#f8e9de",
  statusCritical: "#b3413f",
  statusCriticalSoft: "#f6e2e1",

  // HR zone ramp — ordinal, one hue, light (Z1) -> dark (Z5). Unchanged.
  zones: ["#86b6ef", "#5598e7", "#2a78d6", "#1c5cab", "#104281"] as const,
} as const;
