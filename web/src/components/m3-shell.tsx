"use client";

/**
 * Temporary M3 app shell.
 *
 * The M4 shared shell is not merged yet, so /alerts and /quality get a small
 * local shell with the same navigation and theme behaviour. When M4 lands,
 * pages can swap this wrapper without touching feature code.
 */

import { useEffect, useState, type ReactNode } from "react";
import Link from "next/link";
import { usePathname } from "next/navigation";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { useSidebarCollapse } from "./use-sidebar-collapse";

const NAV = [
  { href: "/", label: "Overview", icon: "⌂" },
  { href: "/live", label: "Live monitor", icon: "◉" },
  { href: "/alerts", label: "Alerts", icon: "!" },
  { href: "/analytics", label: "Analytics", icon: "↗" },
  { href: "/insights", label: "Insights", icon: "★" },
  { href: "/quality", label: "Data quality", icon: "✓" },
  { href: "/devices", label: "Devices", icon: "▣" },
];

type M3ShellProps = {
  eyebrow: string;
  title: string;
  description: string;
  headerAction?: ReactNode;
  children: ReactNode;
};

export function M3QueryProvider({ children }: { children: ReactNode }) {
  const [queryClient] = useState(
    () =>
      new QueryClient({
        defaultOptions: {
          queries: {
            retry: 1,
            refetchOnWindowFocus: false,
          },
        },
      }),
  );
  return <QueryClientProvider client={queryClient}>{children}</QueryClientProvider>;
}

export function M3Shell({ eyebrow, title, description, headerAction, children }: M3ShellProps) {
  const pathname = usePathname();
  const [dark, setDark] = useState(false);
  const { collapsed, toggle } = useSidebarCollapse();

  useEffect(() => {
    try {
      setDark(window.localStorage.getItem("agrimonitor-theme") === "dark");
    } catch {
      // Storage can be unavailable; keep the light theme.
    }
  }, []);

  useEffect(() => {
    document.documentElement.classList.toggle("dark", dark);
    try {
      window.localStorage.setItem("agrimonitor-theme", dark ? "dark" : "light");
    } catch {
      // Ignore storage failures.
    }
  }, [dark]);

  function isActive(href: string): boolean {
    // A field page belongs to the Overview tab.
    if (href === "/") return pathname === "/" || pathname.startsWith("/fields/");
    return pathname === href || pathname.startsWith(`${href}/`);
  }

  return (
    <>
      <a href="#m3-content" className="skip-link">
        Skip to content
      </a>

      <aside
        id="app-sidebar"
        className={`m3-sidebar sidebar ${collapsed ? "is-collapsed" : ""} fixed bottom-0 left-0 top-0 z-10 flex flex-col border-r border-[var(--line)] bg-[var(--panel)] px-5 py-7`}
        aria-label="Workspace"
      >
        <div className="sidebar-head mb-12">
          <Link href="/" className="sidebar-brand flex items-center gap-3" aria-label="AgriMonitor home">
            <div className="brand-mark">✦</div>
            <div className="sidebar-label">
              <strong className="text-lg">AgriMonitor</strong>
              <p className="muted text-xs">Farm intelligence</p>
            </div>
          </Link>
          <button
            type="button"
            className="sidebar-toggle"
            onClick={toggle}
            aria-expanded={!collapsed}
            aria-controls="app-sidebar"
            aria-label={collapsed ? "Expand sidebar" : "Collapse sidebar"}
            title={collapsed ? "Expand sidebar" : "Collapse sidebar"}
          >
            <span aria-hidden="true">{collapsed ? "»" : "«"}</span>
          </button>
        </div>

        <p className="eyebrow sidebar-label mb-3 px-3">Workspace</p>
        <nav className="m3-sidebar-nav space-y-1" aria-label="Main navigation">
          {NAV.map((item) => (
            <Link
              key={item.href}
              href={item.href}
              className={`nav-item ${isActive(item.href) ? "nav-item-active" : ""}`}
              aria-current={isActive(item.href) ? "page" : undefined}
              title={collapsed ? item.label : undefined}
            >
              <span className="w-5 text-center text-lg" aria-hidden="true">
                {item.icon}
              </span>
              <span className="sidebar-label">{item.label}</span>
            </Link>
          ))}
        </nav>

        <div className="system-card mt-auto" title={collapsed ? "Pipeline healthy" : undefined}>
          <div className="flex items-center gap-2">
            <span className="status-pulse shrink-0 bg-emerald-400" />
            <p className="sidebar-label text-sm font-semibold">Pipeline healthy</p>
          </div>
          <p className="sidebar-label muted mt-2 text-xs">
            Alerts and quality metadata are available.
          </p>
        </div>
      </aside>

      <main id="m3-content" tabIndex={-1} className={`main m3-main ${collapsed ? "is-collapsed" : ""}`}>
        <div className="mx-auto max-w-[1400px]">
          <header className="mb-6 flex flex-wrap items-start justify-between gap-4 sm:mb-8">
            <div className="min-w-0 flex-1">
              <p className="eyebrow mb-2">{eyebrow}</p>
              <h1 className="text-2xl font-semibold tracking-tight sm:text-3xl">{title}</h1>
              <p className="muted mt-2 max-w-2xl text-sm">{description}</p>
            </div>
            <div className="flex w-full flex-wrap items-center justify-end gap-2 sm:w-auto">
              {headerAction}
              <button
                type="button"
                aria-label="Toggle theme"
                onClick={() => setDark((value) => !value)}
                className="icon-button"
              >
                {dark ? "☼" : "☾"}
              </button>
              <div className="profile-chip">
                <span>LN</span>
                <b className="hidden sm:inline">Linh Nguyen</b>
              </div>
            </div>
          </header>
          {children}
        </div>
      </main>

      <nav
        className="m3-mobile-nav mobile-nav fixed bottom-0 left-0 right-0 z-20 justify-around border-t border-[var(--line)] bg-[var(--panel)] p-2"
        aria-label="Mobile navigation"
      >
        {NAV.map((item) => (
          <Link
            key={item.href}
            href={item.href}
            className={`mobile-nav-item rounded-lg ${isActive(item.href) ? "bg-emerald-500/20 font-bold text-emerald-500" : ""}`}
            aria-current={isActive(item.href) ? "page" : undefined}
          >
            <span className="block text-lg" aria-hidden="true">
              {item.icon}
            </span>
            {item.label}
          </Link>
        ))}
      </nav>
    </>
  );
}
