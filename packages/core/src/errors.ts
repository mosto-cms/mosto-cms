/**
 * Standard errors of the mosto-cms/1 protocol.
 *
 * Every failure crossing the protocol boundary is a `CmsError` with a stable
 * machine-readable `code`. Clients (the admin, a platform connector, an MCP
 * bridge, a script) branch on the code, never on the message.
 */

export const ERROR_CODES = [
  'bad_request',
  'unauthorized',
  'forbidden',
  'not_found',
  'field_not_editable',
  'invalid_value',
  'conflict',
  'too_large',
  'unsupported',
  'invalid_schema',
  'internal',
] as const;

export type CmsErrorCode = (typeof ERROR_CODES)[number];

/** Suggested HTTP status for each code, used by HTTP transports. */
export const ERROR_HTTP_STATUS: Record<CmsErrorCode, number> = {
  bad_request: 400,
  unauthorized: 401,
  forbidden: 403,
  not_found: 404,
  field_not_editable: 403,
  invalid_value: 422,
  conflict: 409,
  too_large: 413,
  unsupported: 422,
  invalid_schema: 500,
  internal: 500,
};

export class CmsError extends Error {
  readonly code: CmsErrorCode;
  readonly details?: Record<string, unknown>;

  constructor(
    code: CmsErrorCode,
    message: string,
    details?: Record<string, unknown>,
  ) {
    super(message);
    this.name = 'CmsError';
    this.code = code;
    if (details) this.details = details;
  }

  toJSON(): { code: CmsErrorCode; message: string; details?: Record<string, unknown> } {
    return this.details
      ? { code: this.code, message: this.message, details: this.details }
      : { code: this.code, message: this.message };
  }
}

export function isCmsError(err: unknown): err is CmsError {
  return err instanceof CmsError;
}

/** Normalize anything thrown into a CmsError (unknown errors become `internal`). */
export function toCmsError(err: unknown): CmsError {
  if (isCmsError(err)) return err;
  const message = err instanceof Error ? err.message : String(err);
  return new CmsError('internal', message || 'internal error');
}
