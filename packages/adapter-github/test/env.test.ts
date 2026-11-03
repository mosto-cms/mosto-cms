import { describe, expect, it } from 'vitest';

import { githubAdapterFromEnv, githubOptionsFromEnv } from '../src/index.js';

describe('githubOptionsFromEnv', () => {
  it('is null without a repo, so the site can fall back to the disk', () => {
    expect(githubOptionsFromEnv({})).toBeNull();
    expect(githubAdapterFromEnv({})).toBeNull();
  });

  it('reads a token setup', () => {
    expect(githubOptionsFromEnv({ MOSTO_CMS_GITHUB_REPO: 'acme/site', MOSTO_CMS_GITHUB_TOKEN: 't' })).toEqual({
      owner: 'acme',
      repo: 'site',
      branch: 'main',
      auth: { token: 't' },
    });
    expect(githubAdapterFromEnv({ MOSTO_CMS_GITHUB_REPO: 'acme/site', MOSTO_CMS_GITHUB_TOKEN: 't' })?.name).toBe('github');
  });

  it('prefers a GitHub App when configured', () => {
    const o = githubOptionsFromEnv({
      MOSTO_CMS_GITHUB_REPO: 'acme/site',
      MOSTO_CMS_GITHUB_BRANCH: 'content',
      MOSTO_CMS_GITHUB_TOKEN: 't',
      MOSTO_CMS_GITHUB_APP_ID: '123',
      MOSTO_CMS_GITHUB_APP_PRIVATE_KEY: 'pem',
      MOSTO_CMS_GITHUB_APP_INSTALLATION_ID: '9',
    });
    expect(o?.branch).toBe('content');
    expect(o?.auth).toEqual({ app: { appId: '123', privateKey: 'pem', installationId: 9 } });
  });

  it('refuses a malformed repo or a repo without credentials', () => {
    expect(() => githubOptionsFromEnv({ MOSTO_CMS_GITHUB_REPO: 'acme' })).toThrow(/owner\/repo/);
    expect(() => githubOptionsFromEnv({ MOSTO_CMS_GITHUB_REPO: 'acme/site' })).toThrow(/TOKEN/);
  });
});

describe('githubOptionsFromEnv: rootDir', () => {
  it('plumbs MOSTO_CMS_GITHUB_ROOT_DIR through, absent otherwise', () => {
    expect(
      githubOptionsFromEnv({ MOSTO_CMS_GITHUB_REPO: 'acme/site', MOSTO_CMS_GITHUB_TOKEN: 't', MOSTO_CMS_GITHUB_ROOT_DIR: 'apps/web' }),
    ).toMatchObject({ rootDir: 'apps/web' });
    expect(githubOptionsFromEnv({ MOSTO_CMS_GITHUB_REPO: 'acme/site', MOSTO_CMS_GITHUB_TOKEN: 't' })).not.toHaveProperty('rootDir');
  });
});
