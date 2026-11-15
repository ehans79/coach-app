import { getPlanHistory } from "@/lib/dashboard/queries";

export const dynamic = "force-dynamic";
import { Card } from "@/components/Card";
import { EmptyState } from "@/components/EmptyState";
import { Badge } from "@/components/Badge";

const SOURCE_LABEL: Record<string, string> = {
  seed: "Initial plan",
  regeneration: "Auto-regenerated",
  manual: "Manual edit",
  fresh_block: "Fresh block",
};

function formatDate(d: Date): string {
  return d.toLocaleDateString("en-GB", { weekday: "short", month: "short", day: "numeric", year: "numeric" });
}

export default async function PlanHistoryPage() {
  const history = await getPlanHistory();

  return (
    <div className="mx-auto max-w-3xl">
      <h1 className="mb-6 text-xl font-semibold text-ink-primary">Plan History</h1>
      <p className="mb-6 text-sm text-ink-secondary">
        Why the plan changed week to week — every version is kept, nothing is overwritten.
      </p>

      {history.length === 0 ? (
        <EmptyState message="No plan versions yet." />
      ) : (
        <div className="flex flex-col gap-3">
          {history.map((p) => (
            <Card key={p.id}>
              <div className="flex items-start justify-between gap-4">
                <div>
                  <div className="text-sm font-medium text-ink-primary">
                    Version {p.version} — week of {p.weekStartDate}
                  </div>
                  <div className="mt-0.5 text-xs text-ink-muted">
                    {SOURCE_LABEL[p.source] ?? p.source} · generated {formatDate(p.generatedAt)}
                  </div>
                </div>
                {p.isActive && <Badge tone="good" label="Active" />}
              </div>
              {p.rationale && <p className="mt-3 text-sm text-ink-secondary">{p.rationale}</p>}
            </Card>
          ))}
        </div>
      )}
    </div>
  );
}
