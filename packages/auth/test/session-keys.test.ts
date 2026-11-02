import { describe, expect, it } from 'vitest';

import {
  clearSessionCookies,
  createConnectorKey,
  createSessionToken,
  deriveKey,
  hashPassword,
  keyIdOf,
  parseCookies,
  parseRevokedKeys,
  readSessionToken,
  serializeSessionCookie,
  sessionTokenFromCookies,
  verifyConnectorKey,
  type Editor,
} from '../src/index.js';

const secret = 'a-test-site-secret-that-is-long-enough-1234';
const otherSecret = 'another-test-site-secret-that-is-long-enough';
let clock = 1_800_000_000_000;
const now = () => clock;

async function editor(): Promise<Editor> {
  return { email: 'anna@example.com', name: 'Anna', passwordHash: await hashPassword('correct horse battery', { logN: 10 }) };
}

describe('site secret', () => {
  it('refuses a missing or short secret', () => {
    expect(() => deriveKey('short', 'x')).toThrow(/MOSTO_CMS_SECRET/);
    expect(() => deriveKey(undefined as unknown as string, 'x')).toThrow(/MOSTO_CMS_SECRET/);
  });
});

describe('editor sessions', () => {
  it('round-trips a session and expires it', async () => {
    const e = await editor();
    const { token, session } = createSessionToken(e, { secret, ttlSeconds: 60, now });
    expect(token.startsWith('mcs1.')).toBe(true);
    expect(readSessionToken(token, [e], { secret, now })).toEqual(session);
    clock += 61_000;
    expect(readSessionToken(token, [e], { secret, now })).toBeNull();
  });

  it('rejects tampered tokens, other secrets and connector keys', async () => {
    const e = await editor();
    const { token } = createSessionToken(e, { secret, now });
    const [p, payload, sig] = token.split('.') as [string, string, string];
    const forged = Buffer.from(JSON.stringify({ ...JSON.parse(Buffer.from(payload, 'base64url').toString()), sub: 'eve@example.com' })).toString('base64url');
    expect(readSessionToken(`${p}.${forged}.${sig}`, [e], { secret, now })).toBeNull();
    expect(readSessionToken(token, [e], { secret: otherSecret, now })).toBeNull();
    const { key } = createConnectorKey({ secret, write: true, now });
    expect(readSessionToken(key, [e], { secret, now })).toBeNull();
    expect(readSessionToken('garbage', [e], { secret, now })).toBeNull();
  });

  it('ends the session when the editor is removed or the password changes', async () => {
    const e = await editor();
    const { token } = createSessionToken(e, { secret, now });
    expect(readSessionToken(token, [], { secret, now })).toBeNull();
    const changed = { ...e, passwordHash: await hashPassword('a brand new password', { logN: 10 }) };
    expect(readSessionToken(token, [changed], { secret, now })).toBeNull();
  });

  it('serializes HttpOnly SameSite=Strict cookies, __Host- on HTTPS', () => {
    const secure = serializeSessionCookie('tok', { secure: true, maxAgeSeconds: 100 });
    expect(secure).toBe('__Host-mosto-cms-session=tok; Path=/; HttpOnly; SameSite=Strict; Max-Age=100; Secure');
    const dev = serializeSessionCookie('tok', { secure: false, maxAgeSeconds: 100 });
    expect(dev).toBe('mosto-cms-session=tok; Path=/; HttpOnly; SameSite=Strict; Max-Age=100');
    expect(clearSessionCookies(true)).toHaveLength(2);
    expect(clearSessionCookies(true).every((c) => c.includes('Max-Age=0'))).toBe(true);
    expect(parseCookies('a=1; b=2=3; ;c')).toEqual({ a: '1', b: '2=3' });
    expect(sessionTokenFromCookies('x=1; mosto-cms-session=dev; __Host-mosto-cms-session=sec')).toBe('sec');
    expect(sessionTokenFromCookies(null)).toBeNull();
  });
});

describe('connector keys', () => {
  it('signs a scope and verifies it without storage', () => {
    const { key, kid, claims } = createConnectorKey({ secret, write: true, collections: ['fleet'], actor: 'ai', label: 'Mosto', now });
    expect(key.split('.')).toHaveLength(3);
    expect(key.startsWith('mck1.')).toBe(true);
    expect(kid).toMatch(/^[A-Za-z0-9_-]{16}$/);
    const v = verifyConnectorKey(key, { secret, now });
    expect(v).toEqual({ ok: true, claims });
    expect(claims.scope).toEqual({ write: true, actor: 'ai', collections: ['fleet'] });
  });

  it('defaults to a read-only human key with no expiry', () => {
    const { claims } = createConnectorKey({ secret, now });
    expect(claims.scope).toEqual({ write: false, actor: 'human' });
    expect(claims.expiresAt).toBeUndefined();
  });

  it('rejects forged, foreign, re-epoched, expired and revoked keys', () => {
    const { key, kid } = createConnectorKey({ secret, write: false, expiresInSeconds: 60, now });
    const [p, payload, sig] = key.split('.') as [string, string, string];
    const escalated = Buffer.from(JSON.stringify({ ...JSON.parse(Buffer.from(payload, 'base64url').toString()), w: true })).toString('base64url');
    expect(verifyConnectorKey(`${p}.${escalated}.${sig}`, { secret, now })).toEqual({ ok: false, reason: 'bad_signature' });
    expect(verifyConnectorKey(key, { secret: otherSecret, now })).toEqual({ ok: false, reason: 'bad_signature' });
    expect(verifyConnectorKey(key, { secret, epoch: 1, now })).toEqual({ ok: false, reason: 'bad_signature' });
    expect(verifyConnectorKey(key, { secret, revoked: [kid], now })).toEqual({ ok: false, reason: 'revoked' });
    expect(verifyConnectorKey('not-a-key', { secret, now })).toEqual({ ok: false, reason: 'malformed' });
    expect(verifyConnectorKey('mck1.abc', { secret, now })).toEqual({ ok: false, reason: 'malformed' });
    clock += 61_000;
    expect(verifyConnectorKey(key, { secret, now })).toEqual({ ok: false, reason: 'expired' });
  });

  it('keeps the epoch per key family: sessions survive a key epoch bump', async () => {
    const e = await editor();
    const { token } = createSessionToken(e, { secret, now });
    const { key } = createConnectorKey({ secret, epoch: 2, now });
    expect(verifyConnectorKey(key, { secret, epoch: '2', now }).ok).toBe(true);
    expect(verifyConnectorKey(key, { secret, epoch: 3, now }).ok).toBe(false);
    expect(readSessionToken(token, [e], { secret, now })).not.toBeNull();
  });

  it('validates the inputs of a new key', () => {
    expect(() => createConnectorKey({ secret, collections: ['bad key!'] })).toThrow(/collections/);
    expect(() => createConnectorKey({ secret, label: 'x'.repeat(81) })).toThrow(/label/);
    expect(() => createConnectorKey({ secret: 'short' })).toThrow(/MOSTO_CMS_SECRET/);
  });

  it('extracts key ids and parses revocation lists in every format', () => {
    const a = createConnectorKey({ secret, now });
    const b = createConnectorKey({ secret, now });
    expect(keyIdOf(a.key)).toBe(a.kid);
    expect(keyIdOf('nope')).toBeNull();
    expect(parseRevokedKeys(`${a.kid}, ${b.kid}\n`)).toEqual(new Set([a.kid, b.kid]));
    expect(parseRevokedKeys([a.key, 'short', 42])).toEqual(new Set([a.kid]));
    expect(parseRevokedKeys({ revoked: [{ kid: b.kid }, a.kid] })).toEqual(new Set([a.kid, b.kid]));
    expect(parseRevokedKeys(null)).toEqual(new Set());
  });
});
