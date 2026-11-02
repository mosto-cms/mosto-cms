/**
 * Build the adapter from the standard environment variables, so a site picks
 * GitHub in production and the disk in development with one line.
 *
 *   MOSTO_CMS_GITHUB_REPO              owner/repo
 *   MOSTO_CMS_GITHUB_BRANCH            default "main"
 *   MOSTO_CMS_GITHUB_TOKEN             a token with contents:write, or the App below
 *   MOSTO_CMS_GITHUB_APP_ID            GitHub App id
 *   MOSTO_CMS_GITHUB_APP_PRIVATE_KEY   its PEM private key ("\n" escapes accepted)
 *   MOSTO_CMS_GITHUB_APP_INSTALLATION_ID  optional
 */
import { CmsError, type ContentAdapter } from '@mosto-cms/core';

import { createGithubAdapter, type GithubAdapterOptions, type GithubAuth } from './adapter.js';

/** Adapter options from env, or null when `MOSTO_CMS_GITHUB_REPO` is not set. Throws if the repo is set without credentials. */
export function githubOptionsFromEnv(env: Record<string, string | undefined>): GithubAdapterOptions | null {
  const raw = env.MOSTO_CMS_GITHUB_REPO?.trim();
  if (!raw) return null;
  const m = raw.match(/^([A-Za-z0-9_.-]+)\/([A-Za-z0-9_.-]+)$/);
  if (!m) throw new CmsError('internal', 'MOSTO_CMS_GITHUB_REPO must look like "owner/repo"');
  let auth: GithubAuth;
  if (env.MOSTO_CMS_GITHUB_APP_ID && env.MOSTO_CMS_GITHUB_APP_PRIVATE_KEY) {
    const installationId = env.MOSTO_CMS_GITHUB_APP_INSTALLATION_ID ? Number(env.MOSTO_CMS_GITHUB_APP_INSTALLATION_ID) : undefined;
    auth = {
      app: {
        appId: env.MOSTO_CMS_GITHUB_APP_ID,
        privateKey: env.MOSTO_CMS_GITHUB_APP_PRIVATE_KEY,
        ...(installationId && Number.isFinite(installationId) ? { installationId } : {}),
      },
    };
  } else if (env.MOSTO_CMS_GITHUB_TOKEN) {
    auth = { token: env.MOSTO_CMS_GITHUB_TOKEN };
  } else {
    throw new CmsError('internal', 'MOSTO_CMS_GITHUB_REPO is set but neither MOSTO_CMS_GITHUB_TOKEN nor a GitHub App is configured');
  }
  return { owner: m[1] as string, repo: m[2] as string, branch: env.MOSTO_CMS_GITHUB_BRANCH?.trim() || 'main', auth };
}

export function githubAdapterFromEnv(env: Record<string, string | undefined>): ContentAdapter | null {
  const opts = githubOptionsFromEnv(env);
  return opts ? createGithubAdapter(opts) : null;
}
