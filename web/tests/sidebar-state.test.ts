import { describe, expect, it } from "vitest";
import {
  SIDEBAR_STORAGE_KEY,
  readSidebarCollapsed,
  writeSidebarCollapsed,
} from "@/components/use-sidebar-collapse";

function fakeStorage(initial: Record<string, string> = {}) {
  const values = new Map(Object.entries(initial));
  return {
    getItem: (key: string) => values.get(key) ?? null,
    setItem: (key: string, value: string) => void values.set(key, value),
    values,
  };
}

describe("sidebar collapse preference", () => {
  it("defaults to expanded when nothing is stored", () => {
    expect(readSidebarCollapsed(fakeStorage())).toBe(false);
    expect(readSidebarCollapsed(null)).toBe(false);
  });

  it("reads a stored collapse flag", () => {
    expect(readSidebarCollapsed(fakeStorage({ [SIDEBAR_STORAGE_KEY]: "1" }))).toBe(true);
    expect(readSidebarCollapsed(fakeStorage({ [SIDEBAR_STORAGE_KEY]: "0" }))).toBe(false);
  });

  it("writes the flag when the operator toggles", () => {
    const storage = fakeStorage();
    writeSidebarCollapsed(storage, true);
    expect(storage.values.get(SIDEBAR_STORAGE_KEY)).toBe("1");
    writeSidebarCollapsed(storage, false);
    expect(storage.values.get(SIDEBAR_STORAGE_KEY)).toBe("0");
  });

  it("survives storage that throws", () => {
    const throwing = {
      getItem: () => {
        throw new Error("blocked");
      },
      setItem: () => {
        throw new Error("blocked");
      },
    };
    expect(readSidebarCollapsed(throwing)).toBe(false);
    expect(() => writeSidebarCollapsed(throwing, true)).not.toThrow();
  });
});
