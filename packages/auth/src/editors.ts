/**
 * The editors of a site: a short list configured by the site owner, no
 * database. Each editor has an email, a display name and a password hash
 * (made with `hashPassword`). Usually kept in the `MOSTO_CMS_EDITORS` env
 * variable as JSON:
 *
 *   MOSTO_CMS_EDITORS='[{"email":"anna@example.com","name":"Anna","passwordHash":"scrypt.15.8.1.…"}]'
 *
 * Removing an editor (or changing their password hash) ends their open
 * sessions at the next request.
 */
import { CmsError } from '@mosto-cms/core';

import { isPasswordHash } from './password.js';

export type Editor = {
  email: string;
  name: string;
  passwordHash: string;
};

const EMAIL_RE = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;

export function normalizeEmail(email: string): string {
  return email.trim().toLowerCase();
}

/** Validate an editor list. Throws `internal` with every problem listed (it is a site config error). */
export function parseEditors(input: unknown): Editor[] {
  const raw = typeof input === 'string' ? safeJson(input) : input;
  if (!Array.isArray(raw)) {
    throw new CmsError('internal', 'the editor list must be a JSON array of { email, name, passwordHash }');
  }
  const issues: string[] = [];
  const seen = new Set<string>();
  const editors: Editor[] = [];
  raw.forEach((e: unknown, i) => {
    const o = (e && typeof e === 'object' ? e : {}) as Record<string, unknown>;
    const email = typeof o.email === 'string' ? normalizeEmail(o.email) : '';
    if (!EMAIL_RE.test(email)) issues.push(`editors[${i}].email is not a valid email`);
    else if (seen.has(email)) issues.push(`editors[${i}].email is duplicated`);
    seen.add(email);
    const hash = typeof o.passwordHash === 'string' ? o.passwordHash : '';
    if (!isPasswordHash(hash)) issues.push(`editors[${i}].passwordHash is not a hash made by hashPassword()`);
    const name = typeof o.name === 'string' && o.name.trim() ? o.name.trim() : email;
    editors.push({ email, name, passwordHash: hash });
  });
  if (issues.length > 0) {
    throw new CmsError('internal', `invalid editor list: ${issues.join('; ')}`, { issues });
  }
  return editors;
}

function safeJson(s: string): unknown {
  try {
    return JSON.parse(s);
  } catch {
    throw new CmsError('internal', 'the editor list is not valid JSON');
  }
}

/** Editors from `MOSTO_CMS_EDITORS`. An unset variable means no editor can sign in. */
export function editorsFromEnv(env: Record<string, string | undefined>): Editor[] {
  const raw = env.MOSTO_CMS_EDITORS;
  return raw && raw.trim() ? parseEditors(raw) : [];
}

export function findEditor(editors: Editor[], email: string): Editor | undefined {
  const e = normalizeEmail(email);
  return editors.find((x) => x.email === e);
}
