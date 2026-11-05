/**
 * "Your name" setting used as the responder on alert actions (WEBAPP C-M3).
 * localStorage can throw in private mode or when disabled, so every access is
 * guarded and the caller falls back to asking for a name.
 */

export const RESPONDER_STORAGE_KEY = "agrimonitor.responder";

export function getResponder(): string {
  try {
    if (typeof window === "undefined") return "";
    return window.localStorage.getItem(RESPONDER_STORAGE_KEY)?.trim() ?? "";
  } catch {
    return "";
  }
}

export function setResponder(name: string): void {
  try {
    if (typeof window === "undefined") return;
    const trimmed = name.trim();
    if (!trimmed) {
      window.localStorage.removeItem(RESPONDER_STORAGE_KEY);
      return;
    }
    window.localStorage.setItem(RESPONDER_STORAGE_KEY, trimmed);
  } catch {
    // Storage is unavailable; the action still works for this session.
  }
}

export function clearResponder(): void {
  try {
    if (typeof window === "undefined") return;
    window.localStorage.removeItem(RESPONDER_STORAGE_KEY);
  } catch {
    // Ignore unavailable storage.
  }
}
