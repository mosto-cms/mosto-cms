# Mosto CMS starter

A minimal Next.js App Router site whose home page and menu are editable with Mosto CMS:
`content/*.json` holds the content, `mosto-cms.schema.json` declares the editable fields,
`mosto-cms.config.ts` wires the packages, and the page annotates each editable element with
`data-mosto-field`.

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
files in `content/` directly. Until the admin UI ships, publish through the endpoint, for
example from the browser console on `/admin`:

```js
await fetch('/api/mosto-cms', {
  method: 'POST',
  headers: { 'content-type': 'application/json' },
  body: JSON.stringify({ op: 'publish', input: { changes: [{ collection: 'home', id: 'home', path: 'en.hero.title', value: 'Hello' }] } }),
}).then((r) => r.json());
```

`pnpm test:e2e` at the repository root builds this app and runs the end-to-end test in
`test/e2e.test.ts`.
