"use client";

import { useEffect, useState, type FormEvent } from "react";
import type { Alert } from "@/lib/types";
import type { AlertAction } from "../state";
import { getResponder, setResponder } from "../responder";
import { ALERT_STATUS_LABELS } from "../format";

type ActionDialogProps = {
  alert: Alert;
  action: AlertAction;
  isPending: boolean;
  error?: string | null;
  onCancel: () => void;
  onSubmit: (input: { by: string; note?: string }) => void;
};

export function ActionDialog({
  alert,
  action,
  isPending,
  error,
  onCancel,
  onSubmit,
}: ActionDialogProps) {
  const [by, setBy] = useState("");
  const [note, setNote] = useState("");
  const [localError, setLocalError] = useState("");

  useEffect(() => {
    setBy(getResponder());
  }, []);

  const title = action === "acknowledge" ? "Acknowledge alert" : "Resolve alert";
  const submitLabel = action === "acknowledge" ? "Acknowledge" : "Resolve";

  function handleSubmit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    const responder = by.trim();
    if (!responder) {
      setLocalError("Enter your name so the timeline records who acted.");
      return;
    }
    if (note.length > 500) {
      setLocalError("The note must be 500 characters or fewer.");
      return;
    }
    setLocalError("");
    setResponder(responder);
    onSubmit({ by: responder, note: note.trim() || undefined });
  }

  return (
    <div className="modal-overlay" onClick={(event) => event.target === event.currentTarget && onCancel()}>
      <div
        className="dialog-panel"
        role="dialog"
        aria-modal="true"
        aria-labelledby="alert-action-title"
        aria-describedby="alert-action-description"
      >
        <div className="flex items-start justify-between gap-3">
          <div>
            <p className="eyebrow">Alert response</p>
            <h2 id="alert-action-title" className="mt-1 text-lg font-semibold">
              {title}
            </h2>
          </div>
          <button type="button" className="icon-button" onClick={onCancel} aria-label="Close dialog">
            ×
          </button>
        </div>

        <p id="alert-action-description" className="muted mt-3 text-sm">
          {alert.message}
        </p>
        <p className="muted mt-1 text-xs">
          Current status: <strong>{ALERT_STATUS_LABELS[alert.status] ?? alert.status}</strong>
        </p>

        <form className="mt-5 space-y-4" onSubmit={handleSubmit}>
          <label className="filter-field">
            Your name
            <input
              className="text-input"
              value={by}
              onChange={(event) => setBy(event.target.value)}
              placeholder="e.g. Linh Nguyen"
              maxLength={64}
              autoComplete="name"
              required
            />
          </label>

          <label className="filter-field">
            Note (optional, 500 characters)
            <textarea
              className="text-input min-h-[96px] resize-y"
              value={note}
              onChange={(event) => setNote(event.target.value)}
              maxLength={500}
              placeholder="What did you check or change?"
            />
          </label>

          <div className="flex items-center justify-between gap-3">
            <span className="muted text-xs">{note.length}/500</span>
            <div className="flex gap-2">
              <button type="button" className="button-secondary" onClick={onCancel} disabled={isPending}>
                Cancel
              </button>
              <button type="submit" className="button-primary" disabled={isPending}>
                {isPending ? "Saving…" : submitLabel}
              </button>
            </div>
          </div>

          {(localError || error) && (
            <p role="alert" className="rounded-lg bg-rose-500/10 px-3 py-2 text-sm text-rose-600">
              {localError || error}
            </p>
          )}
        </form>
      </div>
    </div>
  );
}
