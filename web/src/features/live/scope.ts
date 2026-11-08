"use client";
import { usePathname, useSearchParams } from "next/navigation";
import { scopeUrl } from "./scope-url";

/** Feature-local URL scope pending M4's shared useScope (issue #10). */
export function useMonitoringScope() {
  const params = useSearchParams(),
    pathname = usePathname();
  const farmId = params.get("farmId") ?? "",
    fieldId = params.get("fieldId") ?? "";
  function setScope(next: { farmId?: string; fieldId?: string }) {
    window.history.replaceState(
      null,
      "",
      scopeUrl(pathname, window.location.search, next),
    );
  }
  function href(path: string, field = fieldId) {
    const search = new URLSearchParams();
    if (farmId) search.set("farmId", farmId);
    if (field) search.set("fieldId", field);
    return `${path}${search.size ? `?${search}` : ""}`;
  }
  return { farmId, fieldId, setScope, href };
}
