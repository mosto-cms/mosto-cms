# @mosto-cms/adapter-fs

## 0.1.0-alpha.0

### Minor Changes

- 16faf2f: First version of the core engine (schema v1, field addresses, fence, protocol operations) and of the GitHub and file-system adapters.
- 85c0265: The `/admin` interface (visual mode, forms with languages side by side, history with undo, uploads with in-browser compression, English and Italian, phone layout) and the click-to-edit overlay with origin-checked messages and `mostoField()`. The fs adapter can commit with git (`git: true`) for local history. `describe` returns upload limits and `listEditableFields` the content file. SVG uploads are now off by default.

### Patch Changes

- Every package now ships the MIT licence file.
- f8d33ad: New `@mosto-cms/auth` (editor sign-in with email and password, signed session cookie, attempt limits, scoped and revocable connector keys, `mosto-cms-auth` CLI) and `@mosto-cms/next` (protocol route handler with on-demand revalidation, live content reader with build-time fallback, media proxy, `/admin` mount). `adapter-github` gains `githubAdapterFromEnv`. Package exports now point to the built files, with a `mosto-cms-source` condition for working inside the repository.
- Updated dependencies [16faf2f]
- Updated dependencies
- Updated dependencies [f8d33ad]
- Updated dependencies [85c0265]
  - @mosto-cms/core@0.1.0-alpha.0
