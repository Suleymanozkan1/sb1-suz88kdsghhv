/** Typed domain errors. The API layer maps `code` to HTTP status. */
export type DomainErrorCode =
  | "VALIDATION"
  | "NOT_FOUND"
  | "FORBIDDEN"
  | "UNAUTHENTICATED"
  | "CONFLICT"
  | "PERIOD_CLOSED"
  | "INSUFFICIENT_STOCK"
  | "UOM_CONVERSION"
  | "RECIPE_CYCLE"
  | "MISSING_COST"
  | "APPROVAL_REQUIRED"
  | "IMMUTABLE"
  | "DUPLICATE"
  | "RATE_LIMITED";

export class DomainError extends Error {
  constructor(
    public readonly code: DomainErrorCode,
    message: string,
    public readonly details?: unknown,
  ) {
    super(message);
    this.name = "DomainError";
  }
}

export const isDomainError = (e: unknown): e is DomainError => e instanceof DomainError;
