/**
 * One object describing how a site runs Mosto CMS, shared by the route
 * handler, the admin page and the reader. Everything secret is read lazily
 * (at request time), so building the site needs no credentials.
 *
 * Environment variables (all optional except the secret for anything that
 * needs a login or a key):
 *   MOSTO_CMS_SECRET           site secret, at least 32 characters
 *   MOSTO_CMS_EDITORS          JSON list of editors { email, name, passwordHash }
 *   MOSTO_CMS_REVOKED_KEYS     revoked connector key ids, comma separated
 *   MOSTO_CMS_KEY_EPOCH        bump to revoke every connector key at once
 *   MOSTO_CMS_ALLOWED_ORIGINS  extra origins allowed to call with a session cookie
 */
import {
  CmsError,
  loadSchema,
  type ContentAdapter,
  type MostoCmsSchema,
} from '@mosto-cms/core';
import {
  createEditorAuth,
  editorsFromEnv,
  parseRevokedKeys,
  type Editor,
  type EditorAuth,
  type RateLimitOptions,
} from '@mosto-cms/auth';

import { nextRevalidator, type Revalidator } from './revalidate.js';

export const DEFAULT_REVOCATION_FILE = 'mosto-cms.revoked.json';

export type Env = Record<string, string | undefined>;

export type MostoCmsOptions = {
  /** The schema: a `mosto-cms.schema.json` import (v1 or legacy). */
  schema: unknown;
  /** Where content is written (and read for the protocol). A function is called on first use, at request time. */
  adapter: ContentAdapter | ((env: Env) => ContentAdapter);
  /** Defaults to MOSTO_CMS_SECRET. */
  secret?: string;
  /** Defaults to MOSTO_CMS_EDITORS. */
  editors?: Editor[] | ((env: Env) => Editor[]);
  keys?: {
    /** Defaults to MOSTO_CMS_KEY_EPOCH or 0. */
    epoch?: number | string;
    /** Revoked key ids, added to MOSTO_CMS_REVOKED_KEYS. */
    revoked?: string[];
    /**
     * A JSON file in the repo, read through the adapter, listing revoked key ids:
     * `{ "revoked": ["<kid>"] }`. Revoking with a commit needs no redeploy.
     * Default "mosto-cms.revoked.json"; false to disable.
     */
    revocationFile?: string | false;
    /** Seconds the revocation file is cached per server instance. Default 30. */
    revocationCacheSeconds?: number;
  };
  /** Other origins (e.g. a connected platform's admin) allowed to call with an editor session. */
  allowedOrigins?: string[];
  /** Runs after every successful write. Default: `nextRevalidator()`. False to disable. */
  revalidate?: Revalidator | false;
  sessionTtlSeconds?: number;
  rateLimit?: RateLimitOptions;
  /** Where the admin page is mounted. Default "/admin". */
  adminPath?: string;
  /** The `/admin` interface. */
  admin?: AdminOptions;
  /** Where the route handler is mounted. Default "/api/mosto-cms". */
  apiPath?: string;
  /** Commit author email for writes made with a connector key. */
  connectorEmail?: string;
  /** Environment, default `process.env` (tests pass their own). */
  env?: Env;
  now?: () => number;
};

export type AdminOptions = {
  /** Pages offered in visual mode, e.g. `[{ path: '/', label: 'Home' }, { path: '/menu' }]`. Default: the home page. */
  pages?: Array<{ path: string; label?: string }>;
  /** The "Powered by Mosto CMS" link in the admin. Default true. */
  poweredBy?: boolean;
  /** Force the admin language ("en" or "it"); default: the editor's browser, switchable. */
  language?: 'en' | 'it';
};

export type MostoCmsSite = ReturnType<typeof defineMostoCms>;

export function defineMostoCms(options: MostoCmsOptions) {
  const env = (): Env => options.env ?? (process.env as Env);
  const adminPath = options.adminPath ?? '/admin';
  const apiPath = (options.apiPath ?? '/api/mosto-cms').replace(/\/+$/, '');
  const now = options.now ?? Date.now;

  let schema: MostoCmsSchema | null = null;
  /** The validated schema. Throws `invalid_schema` with every issue. */
  function getSchema(): MostoCmsSchema {
    schema ??= loadSchema(options.schema);
    return schema;
  }

  let adapter: ContentAdapter | null = null;
  /** The content adapter. A factory runs once per server instance (it may cache GitHub App tokens). */
  function getAdapter(): ContentAdapter {
    adapter ??= typeof options.adapter === 'function' ? options.adapter(env()) : options.adapter;
    return adapter;
  }

  function getSecret(): string {
    return options.secret ?? env().MOSTO_CMS_SECRET ?? '';
  }

  function getEditors(): Editor[] {
    if (typeof options.editors === 'function') return options.editors(env());
    return options.editors ?? editorsFromEnv(env());
  }

  function allowedOrigins(): string[] {
    const fromEnv = (env().MOSTO_CMS_ALLOWED_ORIGINS ?? '')
      .split(/[\s,]+/)
      .map((s) => s.trim())
      .filter(Boolean);
    return [...(options.allowedOrigins ?? []), ...fromEnv];
  }

  function keyEpoch(): string {
    return String(options.keys?.epoch ?? env().MOSTO_CMS_KEY_EPOCH ?? 0);
  }

  let revocationCache: { at: number; ids: Set<string> } | null = null;
  /** Every revoked key id: config + env + the revocation file (cached). */
  async function revokedKeys(): Promise<Set<string>> {
    const ids = parseRevokedKeys([...(options.keys?.revoked ?? []), ...parseRevokedKeys(env().MOSTO_CMS_REVOKED_KEYS ?? '')]);
    const file = options.keys?.revocationFile === undefined ? DEFAULT_REVOCATION_FILE : options.keys.revocationFile;
    if (file) {
      const ttl = (options.keys?.revocationCacheSeconds ?? 30) * 1000;
      if (!revocationCache || now() - revocationCache.at >= ttl) {
        const stored = await getAdapter().readFile(file);
        let fromFile = new Set<string>();
        if (stored) {
          try {
            fromFile = parseRevokedKeys(JSON.parse(stored.text));
          } catch {
            // A broken revocation file must not open the door: refuse every key.
            throw new CmsError('internal', `${file} is not valid JSON; connector keys are disabled until it is fixed`);
          }
        }
        revocationCache = { at: now(), ids: fromFile };
      }
      for (const id of revocationCache.ids) ids.add(id);
    }
    return ids;
  }

  let auth: EditorAuth | null = null;
  function editorAuth(): EditorAuth {
    auth ??= createEditorAuth({
      get secret() {
        return getSecret();
      },
      editors: getEditors,
      ...(options.sessionTtlSeconds !== undefined ? { sessionTtlSeconds: options.sessionTtlSeconds } : {}),
      ...(options.rateLimit ? { rateLimit: options.rateLimit } : {}),
      get allowedOrigins() {
        return allowedOrigins();
      },
      adminPath,
      now,
    });
    return auth;
  }

  const revalidate: Revalidator | null =
    options.revalidate === false ? null : (options.revalidate ?? nextRevalidator());

  return {
    adminPath,
    apiPath,
    admin: options.admin ?? {},
    now,
    getSchema,
    getAdapter,
    getSecret,
    getEditors,
    allowedOrigins,
    keyEpoch,
    revokedKeys,
    editorAuth,
    revalidate,
    connectorEmail: options.connectorEmail,
    /** Forget cached revocations (after revoking from the admin). */
    clearRevocationCache(): void {
      revocationCache = null;
    },
  };
}
