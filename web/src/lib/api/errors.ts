/**
 * Typed error used by the server-side adapter and route handlers.
 *
 * Keeping the HTTP status on the error lets a route handler translate an
 * adapter failure into the right response without guessing (404 for a missing
 * alert, 409 for an invalid lifecycle transition, 502 for an unreachable API).
 */
export class ApiError extends Error {
  readonly status: number;
  readonly code: string;

  constructor(status: number, message: string, code = "api_error") {
    super(message);
    this.name = "ApiError";
    this.status = status;
    this.code = code;
  }
}

export function isApiError(value: unknown): value is ApiError {
  return value instanceof ApiError;
}
