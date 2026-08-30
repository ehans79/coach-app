import { parseStrengthSession, splitExerciseLoad } from "@/lib/strengthParser";

/** Hevy's "get out of the numbers' way" principle: minimal chrome, generous
 * whitespace, hairline dividers between exercises — no badges, no colored
 * pills competing with the reps. Falls back to the raw text untouched if
 * the plan's wording doesn't match the expected section template. */
export function StrengthSessionDetail({ text }: { text: string }) {
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
