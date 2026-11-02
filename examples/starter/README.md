# Mosto CMS starter

A small Next.js App Router site in English and Italian whose home page, gallery and menu are
editable with Mosto CMS: `content/*.json` holds the content, `mosto-cms.schema.json` declares
the editable fields, `mosto-cms.config.ts` wires the packages, `app/components/home.tsx`
annotates each editable element with `mostoField()`, `app/layout.tsx` mounts the overlay and
`app/media` serves uploads right away.

Inside this repository:

```sh
pnpm install
pnpm build                                   # build the @mosto-cms packages the starter imports
cd examples/starter
cp .env.example .env.local                   # then fill it in:
pnpm exec mosto-cms-auth secret              #   → MOSTO_CMS_SECRET
pnpm exec mosto-cms-auth hash-password       #   → passwordHash in MOSTO_CMS_EDITORS
pnpm dev
```

Sign in at http://localhost:3000/admin. Without `MOSTO_CMS_GITHUB_REPO`, publishing edits the
files in `content/` directly; add `MOSTO_CMS_FS_GIT=1` to also commit each publish, which turns
on History and Undo.

`pnpm test:e2e` at the repository root builds this app and runs the end-to-end tests in `test/`:
the protocol over HTTP (`e2e.test.ts`) and `/admin` in headless Chromium on desktop and on a
phone (`admin.test.ts`).
