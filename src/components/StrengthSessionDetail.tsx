import { parseStrengthSession, splitExerciseLoad } from "@/lib/strengthParser";
import type { PlannedExercise } from "@/lib/dashboard/queries";

const SECTION_ORDER: PlannedExercise["section"][] = ["warm_up", "circuit", "core_finisher", "cool_down"];
const SECTION_LABEL: Record<PlannedExercise["section"], string> = {
  warm_up: "Warm-up",
  circuit: "Circuit",
  core_finisher: "Core finisher",
  cool_down: "Cool-down",
};

function formatLoad(ex: PlannedExercise): string {
  return ex.sets ? `${ex.sets}x${ex.reps}` : `x ${ex.reps}`;
}

function formatSectionMeta(exercises: PlannedExercise[]): string {
  const [{ rounds, restBetweenRoundsSeconds }] = exercises;
  const parts: string[] = [];
  if (rounds) parts.push(`${rounds} rounds`);
  if (restBetweenRoundsSeconds) parts.push(`${restBetweenRoundsSeconds}s between rounds`);
  return parts.join(" · ");
}

/** Renders the catalog-backed, structured exercise list — every exercise
 * here is an exact Garmin Connect exercise name rather than free text, so
 * rest times are always available and shown per-exercise rather than
 * parsed out of a sentence. */
function StructuredSession({ exercises }: { exercises: PlannedExercise[] }) {
  const bySection = new Map<PlannedExercise["section"], PlannedExercise[]>();
  for (const ex of exercises) {
    const list = bySection.get(ex.section) ?? [];
    list.push(ex);
    bySection.set(ex.section, list);
  }

  return (
    <div className="flex flex-col gap-5">
      {SECTION_ORDER.filter((s) => bySection.has(s)).map((section) => {
        const sectionExercises = bySection.get(section)!;
        const isProse = section === "warm_up" || section === "cool_down";
        const meta = formatSectionMeta(sectionExercises);

        return (
          <div key={section}>
            <div className="mb-2 flex items-baseline gap-2">
              <span className="text-[10.5px] font-bold tracking-wider text-ink-muted uppercase">
                {SECTION_LABEL[section]}
              </span>
              {meta && <span className="text-[10.5px] text-ink-muted">{meta}</span>}
            </div>

            {isProse ? (
              <p className="text-xs leading-relaxed text-ink-secondary">
                {sectionExercises.map((ex) => `${ex.exerciseName} (${ex.reps})`).join(", ")}
              </p>
            ) : (
              <div className="flex flex-col">
                {sectionExercises.map((ex, i) => (
                  <div
                    key={i}
                    className="flex items-baseline justify-between gap-3 border-b border-border py-2 text-[13px] last:border-b-0"
                  >
                    <span className="text-ink-primary">{ex.exerciseName}</span>
                    <span className="shrink-0 text-right">
                      <span className="font-mono text-ink-muted tabular-nums">{formatLoad(ex)}</span>
                      {ex.restBetweenSetsSeconds ? (
                        <span className="ml-1.5 text-[10.5px] text-ink-muted">· {ex.restBetweenSetsSeconds}s rest</span>
                      ) : null}
                    </span>
                  </div>
                ))}
              </div>
            )}
          </div>
        );
      })}
    </div>
  );
}

/** Hevy's "get out of the numbers' way" principle: minimal chrome, generous
 * whitespace, hairline dividers between exercises — no badges, no colored
 * pills competing with the reps. Prefers the catalog-backed structured
 * `exercises` (has real rest times); falls back to parsing `text` for
 * older/seeded sessions generated before the Garmin exercise catalog, and
 * to the raw text untouched if even that doesn't match the expected
 * section template. */
export function StrengthSessionDetail({ text, exercises }: { text: string; exercises?: PlannedExercise[] | null }) {
  if (exercises && exercises.length > 0) {
    return <StructuredSession exercises={exercises} />;
  }

  const parsed = parseStrengthSession(text);

  if (!parsed) {
    return <p className="text-xs leading-relaxed whitespace-pre-line text-ink-secondary">{text}</p>;
  }

  return (
    <div className="flex flex-col gap-5">
      {parsed.sections.map((section) => (
        <div key={section.label}>
          <div className="mb-2 flex items-baseline gap-2">
            <span className="text-[10.5px] font-bold tracking-wider text-ink-muted uppercase">{section.label}</span>
            {section.meta && <span className="text-[10.5px] text-ink-muted">{section.meta}</span>}
          </div>

          {section.label === "Warm-up" || section.label === "Cool-down" ? (
            <p className="text-xs leading-relaxed text-ink-secondary">{section.items[0]}</p>
          ) : (
            <div className="flex flex-col">
              {section.items.map((item, i) => {
                const [name, load] = splitExerciseLoad(item);
                return (
                  <div
                    key={i}
                    className="flex items-baseline justify-between gap-3 border-b border-border py-2 text-[13px] last:border-b-0"
                  >
                    <span className="text-ink-primary">{name}</span>
                    {load && <span className="shrink-0 font-mono text-ink-muted tabular-nums">{load}</span>}
                  </div>
                );
              })}
            </div>
          )}
        </div>
      ))}

      {parsed.notes.length > 0 && (
        <p className="border-t border-border pt-3 text-xs leading-relaxed text-ink-muted italic">
          {parsed.notes.join(" ")}
        </p>
      )}
    </div>
  );
}
