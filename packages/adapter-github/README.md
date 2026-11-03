# @mosto-cms/adapter-github

GitHub storage for [Mosto CMS](https://github.com/mosto-cms/mosto-cms). Reads content through
the Contents API and writes through the Git Data API, so a publish that touches several files
is a single commit. Each file is checked against the revision it was read at: if someone else
changed it meanwhile, the commit is refused with `conflict` instead of overwriting.

```ts
import { createGithubAdapter } from '@mosto-cms/adapter-github';

// A fine-grained token with contents:write on the site repo…
createGithubAdapter({ owner: 'acme', repo: 'site', branch: 'main', auth: { token: process.env.GITHUB_TOKEN! } });

// …or the site owner's own GitHub App.
createGithubAdapter({
  owner: 'acme',
  repo: 'site',
  branch: 'main',
  auth: { app: { appId: process.env.GH_APP_ID!, privateKey: process.env.GH_APP_PRIVATE_KEY! } },
});
```

Every request has a timeout and transient GitHub failures (no answer, 5xx, 429) are retried
where repeating is safe; a branch update whose answer was lost is checked on the branch.
Pass `committer: { name, email }` (env `MOSTO_CMS_GITHUB_COMMITTER="Name <email>"`) to commit
as an identity your host knows while the editor stays the author: Vercel refuses commits from
people outside the team.

Supports `history` and `revert`. Node.js 20+. MIT licensed.
