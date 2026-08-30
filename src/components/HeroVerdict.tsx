import type { ReactNode } from "react";
import type { BadgeTone } from "@/components/Badge";

const DOT_COLOR: Record<BadgeTone, string> = {
  good: "var(--status-good)",
  warning: "var(--status-warning)",
  serious: "var(--status-serious)",
  neutral: "var(--ink-muted)",
};

const SOFT_BG: Record<BadgeTone, string> = {
  good: "var(--status-good-soft)",
  warning: "var(--status-warning-soft)",
  serious: "var(--status-serious-soft)",
  neutral: "var(--surface-sunken)",
};

/** The Whoop-style "one headline, not a wall of stats" treatment — a
 * color-coded verdict sentence up top, with anything else (badges, the
 * full narrative, raw metrics) layered below as supporting detail. */
export function HeroVerdict({
  tone,
  eyebrow,
  headline,
  children,
}: {
  tone: BadgeTone;
  eyebrow?: string;
  headline: string;
  children?: ReactNode;
}) {
  return (
    <div className="rounded-2xl bg-surface p-6 shadow-pop">
      <div className="mb-2 flex items-center gap-2">
        <span
          className="h-2.5 w-2.5 shrink-0 rounded-full"
          style={{ backgroundColor: DOT_COLOR[tone], boxShadow: `0 0 0 4px ${SOFT_BG[tone]}` }}
        />
        {eyebrow && <span className="text-xs font-bold tracking-wide text-ink-muted uppercase">{eyebrow}</span>}
      </div>
      <p className="text-2xl leading-tight font-extrabold tracking-tight text-ink-primary text-balance">
        {headline}
      </p>
      {children && <div className="mt-3 text-sm leading-relaxed text-ink-secondary">{children}</div>}
    </div>
  );
}
