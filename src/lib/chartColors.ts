// Raw hex mirrors of the CSS custom properties in globals.css — SVG
// presentation attributes (Recharts fill/stroke props) don't reliably
// resolve var() across browsers, so charts import these directly instead.
export const chartColors = {
  surface: "#fcfcfb",
  gridline: "#e1e0d9",
  axis: "#c3c2b7",
  inkSecondary: "#52514e",
  inkMuted: "#898781",
  accent: "#2a78d6",
  zones: ["#86b6ef", "#5598e7", "#2a78d6", "#1c5cab", "#104281"], // Zone 1 -> Zone 5, light -> dark
};
