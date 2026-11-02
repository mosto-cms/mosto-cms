---
"@mosto-cms/auth": minor
"@mosto-cms/next": minor
"@mosto-cms/adapter-github": minor
"@mosto-cms/core": patch
"@mosto-cms/adapter-fs": patch
---

New `@mosto-cms/auth` (editor sign-in with email and password, signed session cookie, attempt limits, scoped and revocable connector keys, `mosto-cms-auth` CLI) and `@mosto-cms/next` (protocol route handler with on-demand revalidation, live content reader with build-time fallback, media proxy, `/admin` mount). `adapter-github` gains `githubAdapterFromEnv`. Package exports now point to the built files, with a `mosto-cms-source` condition for working inside the repository.
