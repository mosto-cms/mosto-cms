/**
 * Transport-agnostic request handling for mosto-cms/1.
 *
 * An HTTP transport (e.g. `POST /api/mosto-cms`) authenticates the caller,
 * builds a `Cms` scoped to that caller, then hands the parsed JSON body to
 * `handleRequest`. Input is validated here, so every transport gets the same
 * `bad_request` errors.
 */
import { OPERATIONS, PROTOCOL_VERSION, type Change, type Cms, type OperationName } from './cms.js';
import { CmsError, ERROR_HTTP_STATUS, toCmsError, type CmsErrorCode } from './errors.js';

export type ProtocolRequest = { op: OperationName; input?: Record<string, unknown> };

export type ProtocolSuccess = { ok: true; protocol: typeof PROTOCOL_VERSION; result: unknown };
export type ProtocolFailure = {
  ok: false;
  protocol: typeof PROTOCOL_VERSION;
  error: { code: CmsErrorCode; message: string; details?: Record<string, unknown> };
};
export type ProtocolResponse = ProtocolSuccess | ProtocolFailure;

function obj(v: unknown, where: string): Record<string, unknown> {
  if (v == null) return {};
  if (typeof v !== 'object' || Array.isArray(v)) {
    throw new CmsError('bad_request', `${where} must be an object`);
  }
  return v as Record<string, unknown>;
}

function str(v: unknown, where: string): string {
  if (typeof v !== 'string' || v.length === 0) {
    throw new CmsError('bad_request', `${where} must be a non-empty string`);
  }
  return v;
}

function optStr(v: unknown, where: string): string | undefined {
  return v === undefined ? undefined : str(v, where);
}

function value(v: unknown, where: string): string | string[] {
  if (typeof v === 'string') return v;
  if (Array.isArray(v) && v.every((x) => typeof x === 'string')) return v;
  throw new CmsError('bad_request', `${where} must be a string or an array of strings`);
}

function changes(v: unknown): Change[] {
  if (!Array.isArray(v) || v.length === 0) {
    throw new CmsError('bad_request', 'input.changes must be a non-empty array');
  }
  if (v.length > 500) throw new CmsError('too_large', 'at most 500 changes per call');
  return v.map((raw, i) => {
    const c = obj(raw, `changes[${i}]`);
    const out: Change = {
      collection: str(c.collection, `changes[${i}].collection`),
      id: str(c.id, `changes[${i}].id`),
      path: str(c.path, `changes[${i}].path`),
      value: value(c.value, `changes[${i}].value`),
    };
    if (c.before !== undefined) out.before = value(c.before, `changes[${i}].before`);
    return out;
  });
}

/** Parse and validate a raw request body. Throws `bad_request`. */
export function parseRequest(body: unknown): ProtocolRequest {
  const b = obj(body, 'body');
  if (typeof b.op !== 'string' || !(OPERATIONS as readonly string[]).includes(b.op)) {
    throw new CmsError('bad_request', `unknown op "${String(b.op)}"`, { operations: [...OPERATIONS] });
  }
  return { op: b.op as OperationName, input: obj(b.input, 'input') };
}

/** Run one already-parsed request against a Cms. Throws CmsError. */
export async function dispatch(cms: Cms, req: ProtocolRequest): Promise<unknown> {
  const i = req.input ?? {};
  switch (req.op) {
    case 'describe':
      return cms.describe();
    case 'listEditableFields':
      return cms.listEditableFields({ ...(i.collection !== undefined ? { collection: str(i.collection, 'input.collection') } : {}) });
    case 'listEntries': {
      const locale = optStr(i.locale, 'input.locale');
      return cms.listEntries({ collection: str(i.collection, 'input.collection'), ...(locale ? { locale } : {}) });
    }
    case 'getField': {
      const path = optStr(i.path, 'input.path');
      return cms.getField({
        collection: str(i.collection, 'input.collection'),
        id: str(i.id, 'input.id'),
        ...(path ? { path } : {}),
      });
    }
    case 'previewChange':
      return cms.previewChange({ changes: changes(i.changes) });
    case 'publish': {
      const message = i.message === undefined ? undefined : String(i.message);
      let baseRevisions: Record<string, string> | undefined;
      if (i.baseRevisions !== undefined) {
        const br = obj(i.baseRevisions, 'input.baseRevisions');
        baseRevisions = Object.fromEntries(
          Object.entries(br).map(([k, v]) => [k, str(v, `input.baseRevisions.${k}`)]),
        );
      }
      return cms.publish({
        changes: changes(i.changes),
        ...(message !== undefined ? { message } : {}),
        ...(baseRevisions ? { baseRevisions } : {}),
      });
    }
    case 'uploadAsset': {
      let field: { collection: string; path: string } | undefined;
      if (i.field !== undefined) {
        const f = obj(i.field, 'input.field');
        field = { collection: str(f.collection, 'input.field.collection'), path: str(f.path, 'input.field.path') };
      }
      return cms.uploadAsset({
        filename: str(i.filename, 'input.filename'),
        contentType: str(i.contentType, 'input.contentType'),
        dataBase64: str(i.dataBase64, 'input.dataBase64'),
        ...(field ? { field } : {}),
      });
    }
    case 'history': {
      const collection = optStr(i.collection, 'input.collection');
      if (i.limit !== undefined && typeof i.limit !== 'number') {
        throw new CmsError('bad_request', 'input.limit must be a number');
      }
      return cms.history({
        ...(typeof i.limit === 'number' ? { limit: i.limit } : {}),
        ...(collection ? { collection } : {}),
      });
    }
    case 'revert': {
      const message = optStr(i.message, 'input.message');
      return cms.revert({
        revision: str(i.revision, 'input.revision'),
        ...(message ? { message } : {}),
        ...(i.force === true ? { force: true } : {}),
      });
    }
  }
}

/**
 * Full request cycle: parse, dispatch, and wrap the outcome in the standard
 * envelope with a suggested HTTP status. Never throws.
 */
export async function handleRequest(
  cms: Cms,
  body: unknown,
): Promise<{ status: number; body: ProtocolResponse }> {
  try {
    const result = await dispatch(cms, parseRequest(body));
    return { status: 200, body: { ok: true, protocol: PROTOCOL_VERSION, result } };
  } catch (err) {
    const e = toCmsError(err);
    return {
      status: ERROR_HTTP_STATUS[e.code],
      body: { ok: false, protocol: PROTOCOL_VERSION, error: e.toJSON() },
    };
  }
}

/** Helper for transports: an `unauthorized` response without touching the Cms. */
export function unauthorizedResponse(message = 'missing or invalid key'): {
  status: number;
  body: ProtocolFailure;
} {
  return {
    status: 401,
    body: { ok: false, protocol: PROTOCOL_VERSION, error: { code: 'unauthorized', message } },
  };
}
