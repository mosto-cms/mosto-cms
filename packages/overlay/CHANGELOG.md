# @mosto-cms/overlay

## 0.1.0-alpha.2

### Patch Changes

- Next.js 16 Cache Components support and monorepo paths.
  
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

## 0.1.0-alpha.1

### Minor Changes

- Visual editor with two modes, Edit and Browse. Edit (the default) outlines editable elements on hover with their name, marks other content as not editable, edits texts in place on the page (Enter or leaving the field applies to the draft, Esc cancels) and keeps links from navigating. Browse leaves the site alone so links work, and the editor follows to the next page. E switches mode, Esc clears the selection. New messages `mosto:mode`, `mosto:edit`, `mosto:deselect`; `mosto:init` takes `mode` and `labels`, `mosto:select` reports `inline`.

## 0.1.0-alpha.0

### Minor Changes

- 85c0265: The `/admin` interface (visual mode, forms with languages side by side, history with undo, uploads with in-browser compression, English and Italian, phone layout) and the click-to-edit overlay with origin-checked messages and `mostoField()`. The fs adapter can commit with git (`git: true`) for local history. `describe` returns upload limits and `listEditableFields` the content file. SVG uploads are now off by default.

### Patch Changes

- Every package now ships the MIT licence file.
