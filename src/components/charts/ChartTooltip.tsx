"use client";

interface TooltipPayloadItem {
  name: string;
  value: number | string;
  color?: string;
}

export function ChartTooltip({
  active,
  label,
  payload,
  formatValue,
}: {
  active?: boolean;
  label?: string | number;
  payload?: TooltipPayloadItem[];
  formatValue?: (value: number | string) => string;
}) {
  if (!active || !payload || payload.length === 0) return null;

  return (
    <div className="rounded-lg border border-border bg-surface px-3 py-2 text-xs shadow-sm">
      {label && <div className="mb-1 font-medium text-ink-primary">{label}</div>}
      <div className="flex flex-col gap-0.5">
        {payload.map((item) => (
          <div key={item.name} className="flex items-center gap-1.5 text-ink-secondary">
            {item.color && <span className="h-2 w-2 rounded-full" style={{ backgroundColor: item.color }} />}
            <span>{item.name}:</span>
            <span className="font-medium text-ink-primary">
              {formatValue ? formatValue(item.value) : item.value}
            </span>
          </div>
        ))}
      </div>
    </div>
  );
}
