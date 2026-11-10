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

const ICON_PATHS: Record<string, string> = {
  overview: "M3 11.5 12 4l9 7.5M5.5 10v9.5h13V10",
  live: "M3 12h4l2.5-6 4 12 2.5-6H21",
  alerts: "M12 4 2.8 19.5h18.4L12 4Zm0 5.5v5m0 2.5v.01",
  analytics: "M4 19V5m0 14h16M8 15l3.5-4 3 2.5L19 8",
  insights: "M12 3l2.4 5.4 5.6.6-4.2 3.8 1.2 5.7L12 15.6 7 18.5l1.2-5.7L4 9l5.6-.6L12 3Z",
  quality: "M12 3 4.5 6v5.5c0 4.4 3.1 7.6 7.5 9.5 4.4-1.9 7.5-5.1 7.5-9.5V6L12 3Zm-3 9 2.2 2.2L15.5 10",
  devices: "M7 4h10a1 1 0 0 1 1 1v14a1 1 0 0 1-1 1H7a1 1 0 0 1-1-1V5a1 1 0 0 1 1-1Zm5 13.5v.01M9 7.5h6",
};

function NavIcon({ name }: { name: string }) {
  return (
    <svg viewBox="0 0 24 24" width="20" height="20" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
      <path d={ICON_PATHS[name]} />
    </svg>
  );
}

const NAV = [
  { href: "/", short: "Home", label: "Overview", icon: "overview" },
  { href: "/live", short: "Live", label: "Live monitor", icon: "live" },
  { href: "/alerts", short: "Alerts", label: "Alerts", icon: "alerts" },
  { href: "/analytics", short: "Trends", label: "Analytics", icon: "analytics" },
  { href: "/insights", short: "Insights", label: "Insights", icon: "insights" },
  { href: "/quality", short: "Quality", label: "Data quality", icon: "quality" },
  { href: "/devices", short: "Devices", label: "Devices", icon: "devices" },
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
              <span className="flex w-5 justify-center" aria-hidden="true">
                <NavIcon name={item.icon} />
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
            <span className="mx-auto mb-0.5 flex justify-center" aria-hidden="true">
              <NavIcon name={item.icon} />
            </span>
            {item.short}
          </Link>
        ))}
      </nav>
    </>
  );
}
