/**
 * Connector keys: how a platform or a script calls a site's `/api/mosto-cms`.
 *
 * Verifiable without a database. A key is a token signed with a subkey of the
 * site secret:
 *
 *   mck1.<base64url(json)>.<base64url(hmac-sha256)>
 *   json = { v: 1, kid, w, c?, a, iat, exp?, l? }
 *
 *   kid  random key id (16 chars), the handle used to revoke it
 *   w    write allowed (publish, uploadAsset, revert)
 *   c    collections allowed (absent: all)
 *   a    actor: "human" or "ai" (ai cannot write fields marked ai.locked)
 *   iat  issued at, exp optional expiry (unix seconds), l optional label
 *
 * The subkey is HKDF(secret, info = "connector-key/v1/epoch:<epoch>"), so:
 *   - revoking ONE key = adding its kid to the revocation list (env, config or
 *     a revocation file in the repo, see @mosto-cms/next);
 *   - revoking ALL keys = bumping the key epoch (MOSTO_CMS_KEY_EPOCH), which
 *     leaves editor sessions alone;
 *   - rotating the site secret ends every key and every session.
 *
 * The key is a bearer secret: whoever holds it has its scope. Only its kid is
 * meant to be shown in lists or logs.
 */
import { randomBytes } from 'node:crypto';

import { b64url, deriveKey, fromB64url, signToken, verifyToken } from './crypto.js';

export const KEY_PREFIX = 'mck1';

export type KeyScope = {
  /** Write operations allowed. Default false: keys are read-only unless asked. */
  write: boolean;
  /** Collections allowed. Undefined: all. */
  collections?: string[];
  actor: 'human' | 'ai';
};

export type ConnectorKeyClaims = {
  kid: string;
  scope: KeyScope;
  label?: string;
  issuedAt: number;
  expiresAt?: number;
};

export type KeyVerifyFailure = 'malformed' | 'bad_signature' | 'expired' | 'revoked';

export type KeySecretOptions = {
  secret: string;
  /** Key epoch: bump it to invalidate every key at once. Default 0. */
  epoch?: number | string;
  now?: () => number;
};

const KID_RE = /^[A-Za-z0-9_-]{16}$/;
const COLLECTION_RE = /^[A-Za-z0-9_-]+$/;

function keyFor(opts: KeySecretOptions): Buffer {
  return deriveKey(opts.secret, `connector-key/v1/epoch:${String(opts.epoch ?? 0)}`);
}

export type CreateKeyInput = KeySecretOptions & {
  write?: boolean;
  collections?: string[];
  actor?: 'human' | 'ai';
  label?: string;
  /** Lifetime in seconds. Default: no expiry (revoke it instead). */
  expiresInSeconds?: number;
};

export function createConnectorKey(input: CreateKeyInput): { key: string; kid: string; claims: ConnectorKeyClaims } {
  if (input.collections !== undefined) {
    if (!Array.isArray(input.collections) || input.collections.some((c) => typeof c !== 'string' || !COLLECTION_RE.test(c))) {
      throw new Error('collections must be an array of collection keys');
    }
  }
  if (input.label !== undefined && (typeof input.label !== 'string' || input.label.length > 80)) {
    throw new Error('label must be a string of at most 80 characters');
  }
  const kid = b64url(randomBytes(12));
  const iat = Math.floor((input.now ?? Date.now)() / 1000);
  const exp = input.expiresInSeconds !== undefined ? iat + Math.floor(input.expiresInSeconds) : undefined;
  const scope: KeyScope = {
    write: input.write === true,
    actor: input.actor === 'ai' ? 'ai' : 'human',
    ...(input.collections ? { collections: [...input.collections] } : {}),
  };
  const payload = {
    v: 1,
    kid,
    w: scope.write,
    ...(scope.collections ? { c: scope.collections } : {}),
    a: scope.actor,
    iat,
    ...(exp !== undefined ? { exp } : {}),
    ...(input.label ? { l: input.label } : {}),
  };
  const key = signToken(KEY_PREFIX, keyFor(input), payload);
  return {
    key,
    kid,
    claims: {
      kid,
      scope,
      issuedAt: iat,
      ...(exp !== undefined ? { expiresAt: exp } : {}),
      ...(input.label ? { label: input.label } : {}),
    },
  };
}

export type VerifyKeyOptions = KeySecretOptions & {
  /** Revoked key ids. */
  revoked?: Iterable<string>;
};

export function verifyConnectorKey(
  key: string,
  opts: VerifyKeyOptions,
): { ok: true; claims: ConnectorKeyClaims } | { ok: false; reason: KeyVerifyFailure } {
  if (typeof key !== 'string' || !key.startsWith(`${KEY_PREFIX}.`)) return { ok: false, reason: 'malformed' };
  const p = verifyToken(KEY_PREFIX, keyFor(opts), key);
  if (!p) {
    return { ok: false, reason: key.split('.').length === 3 ? 'bad_signature' : 'malformed' };
  }
  if (
    p.v !== 1 ||
    typeof p.kid !== 'string' ||
    !KID_RE.test(p.kid) ||
    typeof p.w !== 'boolean' ||
    (p.a !== 'human' && p.a !== 'ai') ||
    typeof p.iat !== 'number' ||
    (p.exp !== undefined && typeof p.exp !== 'number') ||
    (p.c !== undefined && (!Array.isArray(p.c) || p.c.some((c) => typeof c !== 'string')))
  ) {
    return { ok: false, reason: 'malformed' };
  }
  const now = Math.floor((opts.now ?? Date.now)() / 1000);
  if (typeof p.exp === 'number' && p.exp <= now) return { ok: false, reason: 'expired' };
  if (opts.revoked) {
    for (const r of opts.revoked) if (r === p.kid) return { ok: false, reason: 'revoked' };
  }
  return {
    ok: true,
    claims: {
      kid: p.kid,
      scope: { write: p.w, actor: p.a, ...(p.c ? { collections: p.c as string[] } : {}) },
      issuedAt: p.iat,
      ...(typeof p.exp === 'number' ? { expiresAt: p.exp } : {}),
      ...(typeof p.l === 'string' ? { label: p.l } : {}),
    },
  };
}

/** The key id of a key, WITHOUT verifying it (to fill a revocation list). Null if not a key. */
export function keyIdOf(key: string): string | null {
  const parts = typeof key === 'string' ? key.split('.') : [];
  if (parts.length !== 3 || parts[0] !== KEY_PREFIX) return null;
  try {
    const p = JSON.parse(fromB64url(parts[1] as string).toString('utf8')) as { kid?: unknown };
    return typeof p.kid === 'string' && KID_RE.test(p.kid) ? p.kid : null;
  } catch {
    return null;
  }
}

/**
 * Parse a revocation list: a comma/space/newline separated string of key ids
 * (the `MOSTO_CMS_REVOKED_KEYS` env format), an array of ids, or a revocation
 * file `{ "revoked": ["<kid>", …] }` (entries may also be `{ "kid": "…" }`).
 * Full keys are accepted too and reduced to their id.
 */
export function parseRevokedKeys(input: unknown): Set<string> {
  const out = new Set<string>();
  const add = (v: unknown) => {
    if (typeof v === 'string') {
      const s = v.trim();
      if (!s) return;
      const kid = s.startsWith(`${KEY_PREFIX}.`) ? keyIdOf(s) : s;
      if (kid && KID_RE.test(kid)) out.add(kid);
    } else if (v && typeof v === 'object' && typeof (v as { kid?: unknown }).kid === 'string') {
      add((v as { kid: string }).kid);
    }
  };
  if (typeof input === 'string') input.split(/[\s,]+/).forEach(add);
  else if (Array.isArray(input)) input.forEach(add);
  else if (input && typeof input === 'object' && Array.isArray((input as { revoked?: unknown }).revoked)) {
    (input as { revoked: unknown[] }).revoked.forEach(add);
  }
  return out;
}
