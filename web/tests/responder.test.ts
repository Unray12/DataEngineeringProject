import { afterEach, describe, expect, it } from "vitest";
import {
  RESPONDER_STORAGE_KEY,
  clearResponder,
  getResponder,
  setResponder,
} from "@/features/alerts/responder";

const hadWindow = Object.prototype.hasOwnProperty.call(globalThis, "window");
const originalWindow = (globalThis as { window?: unknown }).window;

function installWindow(value: unknown) {
  Object.defineProperty(globalThis, "window", { configurable: true, value });
}

afterEach(() => {
  if (hadWindow) installWindow(originalWindow);
  else Reflect.deleteProperty(globalThis, "window");
});

describe("responder setting", () => {
  it("returns an empty name when localStorage is unavailable", () => {
    Reflect.deleteProperty(globalThis, "window");
    expect(getResponder()).toBe("");
    expect(() => setResponder("Linh")).not.toThrow();
    expect(() => clearResponder()).not.toThrow();
  });

  it("stores a trimmed responder name", () => {
    const data = new Map<string, string>();
    installWindow({
      localStorage: {
        getItem: (key: string) => data.get(key) ?? null,
        setItem: (key: string, value: string) => data.set(key, value),
        removeItem: (key: string) => data.delete(key),
      },
    });

    setResponder("  Linh Nguyen  ");
    expect(data.get(RESPONDER_STORAGE_KEY)).toBe("Linh Nguyen");
    expect(getResponder()).toBe("Linh Nguyen");

    clearResponder();
    expect(getResponder()).toBe("");
  });

  it("does not throw when the browser blocks storage", () => {
    installWindow({
      get localStorage() {
        throw new Error("storage blocked");
      },
    });

    expect(getResponder()).toBe("");
    expect(() => setResponder("Linh")).not.toThrow();
  });
});
