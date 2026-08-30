// Best-effort structure extraction from the plan generator's free-text
// strength instructions (see STRENGTH_REFERENCE in regeneration.ts for the
// template it's usually written to: Warm-up / Circuit / Core finisher /
// Cool-down, each either one descriptive line or a bulleted exercise list).
// Never a guarantee — the LLM's exact phrasing varies — so callers must
// treat a null return as "doesn't match the template" and fall back to
// showing the raw text.
const SECTION_LABELS = ["Warm-up", "Circuit", "Core finisher", "Cool-down"] as const;
export type StrengthSectionLabel = (typeof SECTION_LABELS)[number];

export interface StrengthSection {
  label: StrengthSectionLabel;
  meta: string;
  items: string[];
}

export interface ParsedStrengthSession {
  sections: StrengthSection[];
  notes: string[];
}

function matchSectionHeader(line: string): { label: StrengthSectionLabel; meta: string; rest: string } | null {
  for (const label of SECTION_LABELS) {
    const re = new RegExp(`^${label}\\b(.*)$`, "i");
    const m = line.match(re);
    if (!m) continue;
    const tail = m[1];
    const lastColon = tail.lastIndexOf(":");
    if (lastColon === -1) {
      return { label, meta: tail.trim().replace(/^[-—]\s*/, ""), rest: "" };
    }
    const meta = tail
      .slice(0, lastColon)
      .trim()
      .replace(/^[-—]\s*/, "")
      .replace(/^\(|\)$/g, "");
    const rest = tail.slice(lastColon + 1).trim();
    return { label, meta, rest };
  }
  return null;
}

export function parseStrengthSession(text: string): ParsedStrengthSession | null {
  const lines = text
    .split("\n")
    .map((l) => l.trim())
    .filter(Boolean);

  const sections: StrengthSection[] = [];
  const notes: string[] = [];
  let current: StrengthSection | null = null;

  for (const line of lines) {
    const bulletMatch = line.match(/^[-•]\s*(.+)$/);
    if (bulletMatch && current) {
      current.items.push(bulletMatch[1].trim());
      continue;
    }

    const header = matchSectionHeader(line);
    if (header) {
      const isProse = header.label === "Warm-up" || header.label === "Cool-down";
      current = {
        label: header.label,
        meta: header.meta,
        items: header.rest ? (isProse ? [header.rest] : header.rest.split(/,\s*/).filter(Boolean)) : [],
      };
      sections.push(current);
      continue;
    }

    const isProseSection = current && (current.label === "Warm-up" || current.label === "Cool-down");
    if (isProseSection && current!.items.length === 0) {
      current!.items.push(line);
    } else {
      notes.push(line);
    }
  }

  if (sections.length < 2) return null;
  return { sections, notes };
}

/** Splits "Bodyweight squats x 12-15" -> ["Bodyweight squats", "x 12-15"],
 * or "Plank 3 x 30-45s" -> ["Plank", "3 x 30-45s"]. Returns [item, null]
 * when no set/rep pattern is found. */
export function splitExerciseLoad(item: string): [name: string, load: string | null] {
  const m = item.match(/^(.*?)\s+((?:\d[\d-]*\s*)?[x×]\s*.+)$/i);
  return m ? [m[1], m[2]] : [item, null];
}
