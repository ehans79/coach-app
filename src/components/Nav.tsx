"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";

const NAV_ITEMS = [
  { href: "/", label: "This Week" },
  { href: "/activities", label: "Activity Feed" },
  { href: "/trends", label: "Trends" },
  { href: "/plans", label: "Plan History" },
  { href: "/zones", label: "Zones & Pace" },
];

export function Nav() {
  const pathname = usePathname();

  return (
    <nav className="flex h-full w-56 shrink-0 flex-col border-r border-border bg-surface px-4 py-6">
      <div className="mb-8 px-2">
        <div className="text-sm font-semibold text-ink-primary">Coach</div>
        <div className="text-xs text-ink-muted">Eduardo Hans</div>
      </div>
      <ul className="flex flex-col gap-1">
        {NAV_ITEMS.map((item) => {
          const active = pathname === item.href;
          return (
            <li key={item.href}>
              <Link
                href={item.href}
                className={`block rounded-md px-3 py-2 text-sm transition-colors ${
                  active
                    ? "bg-accent-soft font-medium text-accent"
                    : "text-ink-secondary hover:bg-page hover:text-ink-primary"
                }`}
              >
                {item.label}
              </Link>
            </li>
          );
        })}
      </ul>
    </nav>
  );
}
