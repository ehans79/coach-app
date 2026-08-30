// Raw hex mirrors of the CSS custom properties in globals.css — SVG
// presentation attributes (Recharts fill/stroke props) don't reliably
// resolve var() across browsers, so charts import these directly instead.
// Sourced from theme.ts, the single hex source of truth shared with email.
import { theme } from "@/lib/theme";

export const chartColors = {
  surface: theme.surface,
  gridline: "#e1e0d9",
  axis: "#c3c2b7",
  inkSecondary: theme.inkSecondary,
  inkMuted: theme.inkMuted,
  accent: theme.accent,
  zones: theme.zones, // Zone 1 -> Zone 5, light -> dark
};
