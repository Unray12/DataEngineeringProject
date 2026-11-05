"use client";

import { useCallback, useEffect, useState } from "react";

export const SIDEBAR_STORAGE_KEY = "agrimonitor-sidebar-collapsed";

type Readable = Pick<Storage, "getItem">;
type Writable = Pick<Storage, "setItem">;

/** Reads the stored preference, treating unavailable storage as expanded. */
export function readSidebarCollapsed(storage: Readable | null | undefined): boolean {
  if (!storage) return false;
  try {
    return storage.getItem(SIDEBAR_STORAGE_KEY) === "1";
  } catch {
    return false;
  }
}

/** Persists the preference and ignores storage failures (private mode, quota). */
export function writeSidebarCollapsed(
  storage: Writable | null | undefined,
  collapsed: boolean,
): void {
  if (!storage) return;
  try {
    storage.setItem(SIDEBAR_STORAGE_KEY, collapsed ? "1" : "0");
  } catch {
    // Ignore storage failures; the sidebar still toggles for this visit.
  }
}

function browserStorage(): Storage | null {
  if (typeof window === "undefined") return null;
  try {
    return window.localStorage;
  } catch {
    return null;
  }
}

/**
 * Collapse state shared by the M3 shell and the overview dashboard.
 *
 * The preference is read after mount because the server render has no storage,
 * and it is written only when the operator toggles, so a first visit never
 * overwrites a stored choice with the default.
 */
export function useSidebarCollapse() {
  const [collapsed, setCollapsed] = useState(false);

  useEffect(() => {
    setCollapsed(readSidebarCollapsed(browserStorage()));
  }, []);

  const toggle = useCallback(() => {
    setCollapsed((current) => {
      const next = !current;
      writeSidebarCollapsed(browserStorage(), next);
      return next;
    });
  }, []);

  return { collapsed, toggle };
}
