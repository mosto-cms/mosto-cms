/**
 * Small crypto helpers on top of `node:crypto` (no dependencies).
 *
 * Everything in this package is derived from ONE site secret
 * (`MOSTO_CMS_SECRET`, at least 32 characters). Each use gets its own subkey
 * through HKDF, so an editor session can never be replayed as a connector key
 * and rotating one family of credentials does not touch the other.
 */
import { createHmac, hkdfSync, timingSafeEqual } from 'node:crypto';

import { CmsError } from '@mosto-cms/core';

export const MIN_SECRET_LENGTH = 32;

export function assertSecret(secret: string | undefined): string {
  if (typeof secret !== 'string' || secret.length < MIN_SECRET_LENGTH) {
    throw new CmsError(
      'internal',
      `the site secret (MOSTO_CMS_SECRET) is missing or shorter than ${MIN_SECRET_LENGTH} characters`,
    );
  }
  return secret;
}

/** A 32-byte subkey of the site secret for one purpose (`session/v1`, `connector-key/v1/epoch:0`…). */
export function deriveKey(secret: string, purpose: string): Buffer {
  return Buffer.from(hkdfSync('sha256', assertSecret(secret), 'mosto-cms', purpose, 32));
}

export function b64url(data: Buffer | string): string {
  return Buffer.from(data).toString('base64url');
}

export function fromB64url(s: string): Buffer {
  return Buffer.from(s, 'base64url');
}

export function hmac(key: Buffer, data: string): Buffer {
  return createHmac('sha256', key).update(data).digest();
}

/** Constant-time comparison of two byte strings of possibly different length. */
export function safeEqual(a: Buffer, b: Buffer): boolean {
  if (a.length !== b.length) {
    timingSafeEqual(a, a);
    return false;
  }
  return timingSafeEqual(a, b);
}

/**
 * Sign a JSON payload: `<prefix>.<base64url(json)>.<base64url(hmac)>`.
 * The prefix is part of the signed data, so tokens of one kind cannot be
 * presented as another.
 */
export function signToken(prefix: string, key: Buffer, payload: object): string {
  const body = `${prefix}.${b64url(JSON.stringify(payload))}`;
  return `${body}.${b64url(hmac(key, body))}`;
}

/** Verify and decode a token made by `signToken`. Null if malformed or forged. */
export function verifyToken(prefix: string, key: Buffer, token: string): Record<string, unknown> | null {
  if (typeof token !== 'string' || token.length > 4096) return null;
  const parts = token.split('.');
  if (parts.length !== 3 || parts[0] !== prefix) return null;
  const [, payload, sig] = parts as [string, string, string];
  if (!/^[A-Za-z0-9_-]+$/.test(payload) || !/^[A-Za-z0-9_-]+$/.test(sig)) return null;
  if (!safeEqual(fromB64url(sig), hmac(key, `${prefix}.${payload}`))) return null;
  try {
    const value: unknown = JSON.parse(fromB64url(payload).toString('utf8'));
    return value && typeof value === 'object' && !Array.isArray(value) ? (value as Record<string, unknown>) : null;
  } catch {
    return null;
  }
}
