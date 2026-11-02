/**
 * GitHub App authentication: mint short-lived installation tokens so a site
 * commits as its own App (owned by the site owner) instead of a personal token.
 * Pure node:crypto (RS256 JWT), no dependencies.
 */
import crypto from 'node:crypto';

import { CmsError } from '@mosto-cms/core';

export type GithubAppCredentials = {
  appId: string;
  /** PEM private key of the App. Literal "\n" sequences (as in env vars) are accepted. */
  privateKey: string;
  /** Skip the lookup when known. */
  installationId?: number;
};

export type InstallationToken = { token: string; expiresAt: number };

function b64url(input: string | Buffer): string {
  return Buffer.from(input).toString('base64url');
}

/** The App JWT (RS256), valid ~9 minutes, for the App endpoints. */
export function createAppJwt(appId: string, privateKeyPem: string, nowSeconds = Math.floor(Date.now() / 1000)): string {
  const pem = privateKeyPem.replace(/\\n/g, '\n');
  const header = b64url(JSON.stringify({ alg: 'RS256', typ: 'JWT' }));
  const payload = b64url(JSON.stringify({ iat: nowSeconds - 60, exp: nowSeconds + 540, iss: appId }));
  const signer = crypto.createSign('RSA-SHA256');
  signer.update(`${header}.${payload}`);
  signer.end();
  return `${header}.${payload}.${b64url(signer.sign(pem))}`;
}

/** Resolve the installation on owner/repo (unless given) and mint a token. */
export async function createInstallationToken(opts: {
  app: GithubAppCredentials;
  owner: string;
  repo: string;
  apiUrl: string;
  fetch: typeof fetch;
}): Promise<InstallationToken> {
  const headers = {
    Authorization: `Bearer ${createAppJwt(opts.app.appId, opts.app.privateKey)}`,
    Accept: 'application/vnd.github+json',
    'X-GitHub-Api-Version': '2022-11-28',
  };
  let installationId = opts.app.installationId;
  if (installationId == null) {
    const res = await opts.fetch(`${opts.apiUrl}/repos/${opts.owner}/${opts.repo}/installation`, { headers });
    if (!res.ok) {
      throw new CmsError('internal', `GitHub App is not installed on ${opts.owner}/${opts.repo} (${res.status})`);
    }
    installationId = ((await res.json()) as { id: number }).id;
  }
  const res = await opts.fetch(`${opts.apiUrl}/app/installations/${installationId}/access_tokens`, {
    method: 'POST',
    headers,
  });
  if (!res.ok) {
    throw new CmsError('internal', `GitHub App token request failed (${res.status})`);
  }
  const out = (await res.json()) as { token: string; expires_at?: string };
  const expiresAt = out.expires_at ? Date.parse(out.expires_at) : Date.now() + 50 * 60 * 1000;
  return { token: out.token, expiresAt };
}
