import { beforeEach, describe, expect, it } from "vitest";
import { NextRequest } from "next/server";
import { GET as listAlerts } from "@/app/api/alerts/route";
import { PATCH as patchAlertRoute } from "@/app/api/alerts/[id]/route";
import { resetMockAlerts } from "@/features/alerts/mock-store";
import type { AlertsEnvelope } from "@/lib/api/schemas";

function listRequest(query = ""): NextRequest {
  return new NextRequest(`http://localhost/api/alerts${query}`);
}

function patchRequest(id: string, body: unknown): NextRequest {
  return new NextRequest(`http://localhost/api/alerts/${id}`, {
    method: "PATCH",
    headers: { "content-type": "application/json" },
    body: JSON.stringify(body),
  });
}

async function patch(id: string, body: unknown) {
  return patchAlertRoute(patchRequest(id, body), { params: Promise.resolve({ id }) });
}

beforeEach(() => {
  resetMockAlerts();
});

describe("GET /api/alerts", () => {
  it("returns a no-store envelope of alerts", async () => {
    const response = await listAlerts(listRequest());
    expect(response.status).toBe(200);
    expect(response.headers.get("Cache-Control")).toBe("no-store");
    const body = (await response.json()) as AlertsEnvelope;
    expect(body.meta.source).toBe("cassandra");
    expect(body.data.length).toBeGreaterThan(0);
  });

  it("filters by status and severity", async () => {
    const response = await listAlerts(listRequest("?status=open&severity=critical"));
    const body = (await response.json()) as AlertsEnvelope;
    expect(body.data.length).toBeGreaterThan(0);
    expect(body.data.every((alert) => alert.status === "open")).toBe(true);
    expect(body.data.every((alert) => alert.severity === "critical")).toBe(true);
  });

  it("filters by farm through the field reference", async () => {
    const response = await listAlerts(listRequest("?farmId=farm-highland"));
    const body = (await response.json()) as AlertsEnvelope;
    expect(body.data.length).toBeGreaterThan(0);
    expect(body.data.every((alert) => alert.fieldId.startsWith("field-h"))).toBe(true);
  });

  it("rejects an invalid status with 400", async () => {
    const response = await listAlerts(listRequest("?status=closed"));
    expect(response.status).toBe(400);
  });
});

describe("PATCH /api/alerts/[id]", () => {
  it("acknowledges then resolves an open alert", async () => {
    const acknowledged = await patch("a-1001", {
      action: "acknowledge",
      by: "Test Operator",
      note: "Checked irrigation line.",
    });
    expect(acknowledged.status).toBe(200);
    const acknowledgedBody = (await acknowledged.json()) as { data: { status: string; acknowledgedBy: string; note: string } };
    expect(acknowledgedBody.data.status).toBe("acknowledged");
    expect(acknowledgedBody.data.acknowledgedBy).toBe("Test Operator");
    expect(acknowledgedBody.data.note).toBe("Checked irrigation line.");

    const resolved = await patch("a-1001", {
      action: "resolve",
      by: "Test Operator",
      note: "Irrigation restored.",
    });
    expect(resolved.status).toBe(200);
    const resolvedBody = (await resolved.json()) as { data: { status: string; resolvedBy: string } };
    expect(resolvedBody.data.status).toBe("resolved");
    expect(resolvedBody.data.resolvedBy).toBe("Test Operator");
  });

  it("rejects acknowledging an already acknowledged alert with 409", async () => {
    const response = await patch("a-1003", {
      action: "acknowledge",
      by: "Test Operator",
    });
    expect(response.status).toBe(409);
    const body = (await response.json()) as { code: string };
    expect(body.code).toBe("invalid_transition");
  });

  it("rejects resolving a resolved alert with 409", async () => {
    const first = await patch("a-1007", { action: "resolve", by: "Test Operator" });
    expect(first.status).toBe(409);
  });

  it("rejects an unknown action with 400", async () => {
    const response = await patch("a-1001", { action: "close", by: "Test Operator" });
    expect(response.status).toBe(400);
  });

  it("rejects an empty responder with 400", async () => {
    const response = await patch("a-1001", { action: "acknowledge", by: "   " });
    expect(response.status).toBe(400);
  });

  it("rejects a note longer than 500 characters with 400", async () => {
    const response = await patch("a-1001", {
      action: "acknowledge",
      by: "Test Operator",
      note: "x".repeat(501),
    });
    expect(response.status).toBe(400);
  });

  it("returns 404 for an unknown alert", async () => {
    const response = await patch("a-does-not-exist", {
      action: "acknowledge",
      by: "Test Operator",
    });
    expect(response.status).toBe(404);
  });

  it("round-trips an HTML-looking note without interpreting it", async () => {
    const note = '<img src=x onerror="alert(1)">';
    const response = await patch("a-1001", {
      action: "acknowledge",
      by: "Test Operator",
      note,
    });
    const body = (await response.json()) as { data: { note: string } };
    expect(body.data.note).toBe(note);
  });
});
