---
'@mosto-cms/core': patch
'@mosto-cms/auth': patch
'@mosto-cms/admin': patch
'@mosto-cms/overlay': patch
'@mosto-cms/next': patch
'@mosto-cms/adapter-fs': patch
'@mosto-cms/adapter-github': patch
---

Publishing that never reports a landed commit as a failure, and no rebuilds for content commits.

- `publish` is idempotent: a change whose field already holds the requested value is
  already applied, not a `conflict`. Repeating a publish whose answer was lost commits
  nothing and returns `published: false, alreadyPublished: true` (same for `revert`).
- The admin asks once more when a publish got no definite answer (network error, 5xx), so
  a commit that landed is reported as published. After a publish it keeps the published
  values and re-reads the entries quietly in the background; a failed or lagging re-read
  no longer shows "Something went wrong on the site".
- GitHub adapter: a timeout on every request (`requestTimeoutMs`, default 15 s), retries
  of reads, blobs, trees and commits after a transient failure (no answer, 5xx, 429;
  `retries`, `retryDelayMs`), and a branch update whose answer was lost is checked on the
  branch instead of being reported as failed or repeated blindly.
- New optional `committer` on `createGithubAdapter` (env `MOSTO_CMS_GITHUB_COMMITTER`,
  "Name <email>"): the git committer of every commit, while the editor stays the author.
  Hosts that refuse commits from people outside the team (Vercel `BLOCKED`) accept them.
- `/api/mosto-cms` logs server-side failures as `[mosto-cms] <op> failed: …`.
- Docs: "No rebuilds for content commits (Vercel)": committer + an Ignored Build Step that
  skips commits touching only content and uploads.
