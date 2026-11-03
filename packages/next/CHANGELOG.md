# @mosto-cms/next

## 0.1.0-alpha.1

### Patch Changes

- The `/admin` it mounts and `<MostoOverlay/>` get the Edit and Browse modes with in-place text editing.
- Updated dependencies
  - @mosto-cms/admin@0.1.0-alpha.1
  - @mosto-cms/overlay@0.1.0-alpha.1

## 0.1.0-alpha.0

### Minor Changes

- f8d33ad: New `@mosto-cms/auth` (editor sign-in with email and password, signed session cookie, attempt limits, scoped and revocable connector keys, `mosto-cms-auth` CLI) and `@mosto-cms/next` (protocol route handler with on-demand revalidation, live content reader with build-time fallback, media proxy, `/admin` mount). `adapter-github` gains `githubAdapterFromEnv`. Package exports now point to the built files, with a `mosto-cms-source` condition for working inside the repository.
- 85c0265: The `/admin` interface (visual mode, forms with languages side by side, history with undo, uploads with in-browser compression, English and Italian, phone layout) and the click-to-edit overlay with origin-checked messages and `mostoField()`. The fs adapter can commit with git (`git: true`) for local history. `describe` returns upload limits and `listEditableFields` the content file. SVG uploads are now off by default.

### Patch Changes

- Route handlers now type their second argument as required, so `export const GET = handlers.GET` builds on Next.js 15 as well as 16 (Next.js 15 rejects an optional context at build time). Missing params are still tolerated at runtime.
- Every package now ships the MIT licence file.
- Updated dependencies [16faf2f]
- Updated dependencies
- Updated dependencies [f8d33ad]
- Updated dependencies [85c0265]
  - @mosto-cms/core@0.1.0-alpha.0
  - @mosto-cms/auth@0.1.0-alpha.0
  - @mosto-cms/overlay@0.1.0-alpha.0
  - @mosto-cms/admin@0.1.0-alpha.0
