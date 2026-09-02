"use client";

import Image from "next/image";
import Link from "next/link";
import { usePathname } from "next/navigation";

const NAV_ITEMS = [
  { href: "/", label: "This Week", short: "Week" },
  { href: "/activities", label: "Activity Feed", short: "Activity" },
  { href: "/trends", label: "Trends", short: "Trends" },
  { href: "/plans", label: "Plan History", short: "Plans" },
  { href: "/zones", label: "Zones & Pace", short: "Zones" },
];

export function Nav() {
  const pathname = usePathname();

  return (
    <>
      {/* Desktop sidebar */}
      <nav className="hidden h-full w-56 shrink-0 flex-col border-r border-border bg-surface px-4 py-6 lg:flex">
        <div className="mb-8 flex items-center gap-2.5 px-2">
          {/* Decorative: the wordmark beside it already names the app, so an
              alt here would just make screen readers say "Coach" twice. */}
          <Image
            src="/logo-mark-64.png"
            alt=""
            width={37}
            height={32}
            priority
            className="h-8 w-auto shrink-0"
          />
          <div>
            <div className="text-sm font-semibold text-ink-primary">Coach</div>
            <div className="text-xs text-ink-muted">Eduardo Hans</div>
          </div>
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
                      ? "bg-accent-soft font-semibold text-accent-ink"
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

      {/* Mobile/tablet bottom tab bar */}
      <nav className="fixed inset-x-0 bottom-0 z-10 flex border-t border-border bg-surface pb-[env(safe-area-inset-bottom)] lg:hidden">
        {NAV_ITEMS.map((item) => {
          const active = pathname === item.href;
          return (
            <Link
              key={item.href}
              href={item.href}
              className={`flex flex-1 flex-col items-center gap-0.5 py-2.5 text-[10.5px] font-semibold transition-colors ${
                active ? "text-accent-ink" : "text-ink-muted"
              }`}
            >
              {item.short}
            </Link>
          );
        })}
      </nav>
    </>
  );
}
