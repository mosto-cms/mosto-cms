---
'@mosto-cms/core': patch
'@mosto-cms/auth': patch
'@mosto-cms/admin': patch
'@mosto-cms/overlay': patch
'@mosto-cms/next': patch
'@mosto-cms/adapter-fs': patch
'@mosto-cms/adapter-github': patch
---

Next.js 16 Cache Components support and monorepo paths.

- `createAdminPage` reads the session cookie inside its own Suspense boundary, so the
  admin page builds under `cacheComponents: true` with no `<Suspense>` wrapper and no
  `dynamic` segment config in the site.
- The documented setup no longer uses any route segment config (`dynamic`, `revalidate`,
  `runtime`); content reads on Cache Components sites go through `'use cache'` +
  `cacheLife` + `cacheTag(fileTag(...))`, documented alongside the Next.js 15 ISR pattern.
- New optional `rootDir` on `createGithubAdapter`, `createFsAdapter`, `githubSource` and
  `fsSource` (env: `MOSTO_CMS_GITHUB_ROOT_DIR`) for monorepos where the app is not the
  repository root: schema paths stay clean (`content/home.json`) while the repository
  stores `apps/web/content/home.json`; history and cache tags stay on schema paths.
- `nextRevalidator({ paths })` to limit page expiry to given routes is now documented.
- Docs: a "Next.js 16 Cache Components (and MakerKit)" section with the verified recipe
  (admin at `/cms` via `adminPath`, strict-CSP `frameAncestors: ["'self'"]`, pnpm
  `minimumReleaseAgeExclude`, monorepo paths).
