/**
 * Password hashing with scrypt (memory-hard, built into Node).
 *
 * Format: `scrypt.<log2 N>.<r>.<p>.<salt>.<hash>` (salt and hash base64url).
 * Dots instead of `$` on purpose: the hash lives in `.env` files and env
 * values, where `$` triggers variable expansion in many loaders (Next.js
 * included) and would silently corrupt it.
 */
import { randomBytes, scrypt as scryptCb, type ScryptOptions } from 'node:crypto';

import { b64url, fromB64url, safeEqual } from './crypto.js';

/** Longest password accepted, so a huge input cannot be used to burn CPU. */
export const MAX_PASSWORD_LENGTH = 1024;
export const MIN_PASSWORD_LENGTH = 10;

const DEFAULT = { logN: 15, r: 8, p: 1 } as const;
const KEY_LENGTH = 32;

function scrypt(password: string, salt: Buffer, opts: ScryptOptions): Promise<Buffer> {
  return new Promise((resolve, reject) => {
    scryptCb(password.normalize('NFKC'), salt, KEY_LENGTH, opts, (err, key) => (err ? reject(err) : resolve(key)));
  });
}

function params(logN: number, r: number, p: number): ScryptOptions {
  const N = 2 ** logN;
  return { N, r, p, maxmem: 256 * N * r + 1024 * 1024 };
}

export type HashOptions = { logN?: number; r?: number; p?: number };

/** Hash a password for the editor list (`MOSTO_CMS_EDITORS`). */
export async function hashPassword(password: string, opts: HashOptions = {}): Promise<string> {
  if (typeof password !== 'string' || password.length < MIN_PASSWORD_LENGTH) {
    throw new Error(`passwords must be at least ${MIN_PASSWORD_LENGTH} characters`);
  }
  if (password.length > MAX_PASSWORD_LENGTH) throw new Error('password too long');
  const logN = opts.logN ?? DEFAULT.logN;
  const r = opts.r ?? DEFAULT.r;
  const p = opts.p ?? DEFAULT.p;
  const salt = randomBytes(16);
  const hash = await scrypt(password, salt, params(logN, r, p));
  return ['scrypt', logN, r, p, b64url(salt), b64url(hash)].join('.');
}

const HASH_RE = /^scrypt\.(\d{1,2})\.(\d{1,2})\.(\d{1,2})\.([A-Za-z0-9_-]{16,})\.([A-Za-z0-9_-]{32,})$/;

export function isPasswordHash(value: string): boolean {
  const m = HASH_RE.exec(value);
  if (!m) return false;
  const logN = Number(m[1]);
  return logN >= 10 && logN <= 20 && Number(m[2]) >= 1 && Number(m[3]) >= 1;
}

/** Check a password against a stored hash in constant time. False on any malformed input. */
export async function verifyPassword(password: string, stored: string): Promise<boolean> {
  if (typeof password !== 'string' || password.length === 0 || password.length > MAX_PASSWORD_LENGTH) return false;
  const m = HASH_RE.exec(stored);
  if (!m || !isPasswordHash(stored)) return false;
  const [, logN, r, p, salt, hash] = m as unknown as [string, string, string, string, string, string];
  const expected = fromB64url(hash);
  const actual = await scrypt(password, fromB64url(salt), params(Number(logN), Number(r), Number(p)));
  return safeEqual(actual.subarray(0, expected.length), expected) && expected.length === KEY_LENGTH;
}

/**
 * A valid hash of a random password, used to spend the same time on unknown
 * emails as on known ones (no user enumeration through timing).
 */
let dummyHash: Promise<string> | null = null;
export function getDummyHash(): Promise<string> {
  dummyHash ??= hashPassword(b64url(randomBytes(24)));
  return dummyHash;
}
