import { describe, expect, it } from 'vitest';

import { CmsError } from '@mosto-cms/core';

import { editorsFromEnv, findEditor, hashPassword, isPasswordHash, parseEditors, verifyPassword } from '../src/index.js';

describe('password hashing', () => {
  it('hashes with scrypt in a $-free format and verifies', async () => {
    const hash = await hashPassword('correct horse battery', { logN: 10 });
    expect(hash).toMatch(/^scrypt\.10\.8\.1\.[A-Za-z0-9_-]+\.[A-Za-z0-9_-]+$/);
    expect(hash).not.toContain('$');
    expect(isPasswordHash(hash)).toBe(true);
    expect(await verifyPassword('correct horse battery', hash)).toBe(true);
    expect(await verifyPassword('correct horse batterY', hash)).toBe(false);
  });

  it('uses a fresh salt every time', async () => {
    const a = await hashPassword('correct horse battery', { logN: 10 });
    const b = await hashPassword('correct horse battery', { logN: 10 });
    expect(a).not.toBe(b);
  });

  it('refuses short and huge passwords, and malformed hashes', async () => {
    await expect(hashPassword('short')).rejects.toThrow(/at least/);
    await expect(hashPassword('x'.repeat(2000))).rejects.toThrow(/too long/);
    const hash = await hashPassword('correct horse battery', { logN: 10 });
    expect(await verifyPassword('x'.repeat(2000), hash)).toBe(false);
    expect(await verifyPassword('', hash)).toBe(false);
    expect(await verifyPassword('correct horse battery', 'scrypt$15$8$1$a$b')).toBe(false);
    expect(await verifyPassword('correct horse battery', hash.replace('scrypt.10', 'scrypt.30'))).toBe(false);
    expect(isPasswordHash('plain-text-password')).toBe(false);
  });
});

describe('editor list', () => {
  it('parses JSON from env, normalizes emails and finds editors case-insensitively', async () => {
    const passwordHash = await hashPassword('correct horse battery', { logN: 10 });
    const env = { MOSTO_CMS_EDITORS: JSON.stringify([{ email: ' Anna@Example.com ', name: 'Anna', passwordHash }]) };
    const editors = editorsFromEnv(env);
    expect(editors).toEqual([{ email: 'anna@example.com', name: 'Anna', passwordHash }]);
    expect(findEditor(editors, 'ANNA@example.com')?.name).toBe('Anna');
    expect(editorsFromEnv({})).toEqual([]);
  });

  it('lists every problem of an invalid list', async () => {
    const passwordHash = await hashPassword('correct horse battery', { logN: 10 });
    try {
      parseEditors([
        { email: 'not-an-email', passwordHash },
        { email: 'a@b.co', passwordHash: 'plain' },
        { email: 'c@d.co', passwordHash },
        { email: 'C@d.co', passwordHash },
      ]);
      throw new Error('expected a failure');
    } catch (err) {
      expect(err).toBeInstanceOf(CmsError);
      const issues = (err as CmsError).details?.issues as string[];
      expect(issues).toHaveLength(3);
    }
    expect(() => parseEditors('{oops')).toThrow(/not valid JSON/);
    expect(() => parseEditors({})).toThrow(/JSON array/);
  });

  it('uses the email as name when none is given', async () => {
    const passwordHash = await hashPassword('correct horse battery', { logN: 10 });
    expect(parseEditors([{ email: 'x@y.io', passwordHash }])[0]?.name).toBe('x@y.io');
  });
});
