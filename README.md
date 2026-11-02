# Mosto CMS

**An open-source, git-based CMS for websites you hand over to people who are not developers.**
Your content stays as plain JSON files in your own repository. Editors click on the real site
to change text, images and videos. No database, no server to pay for, no lock-in.

> **Status: early development (v0).** Alpha prereleases are on npm under the `next` tag
> (`npm install @mosto-cms/next@next`); there is no stable release yet. APIs may change until `1.0`.

## Why

Most git-based CMSs ask every editor for a GitHub account, or edit content in forms far away
from the page. Visual-editing CMSs are usually hosted services. Mosto CMS aims at the gap:

- **Content in your repo.** JSON files you can read, diff and move anywhere. Full history in git.
- **Click-to-edit on the real site.** Annotate an element once
  (`data-mosto-field="content:home:en.hero.title"`) and editors change it in place.
- **A fence, not a free-for-all.** A schema lists exactly which fields can change. Anything
  else is refused on the server with `field_not_editable`, whatever the client.
- **Zero infrastructure.** The admin and the API run inside your site (Next.js App Router
  first), on the free tier of Vercel or Netlify.
- **An open protocol.** `mosto-cms/1` is a small, versioned contract (a schema plus a handful
  of operations over one HTTP route) that any tool can drive: the admin, a script, an
  integration you write.
- **Yours for good.** MIT licensed. If you stop working with whoever set it up, the site and
  the CMS keep working exactly the same.

## Packages

| Package | What it does | Status |
|---|---|---|
| [`@mosto-cms/core`](packages/core) | Schema format and validation, field addressing, the fence, the protocol operations, standard errors. No dependencies. | in progress |
| [`@mosto-cms/adapter-github`](packages/adapter-github) | Reads and writes content through the GitHub API: atomic multi-file commits, conflict detection, token or GitHub App auth. | in progress |
| [`@mosto-cms/adapter-fs`](packages/adapter-fs) | Local files, for development. | in progress |
| [`@mosto-cms/next`](packages/next) | Next.js: `/api/mosto-cms` endpoint, live content reader with on-demand revalidation, media proxy, the `/admin` page and the overlay component. | in progress |
| [`@mosto-cms/overlay`](packages/overlay) | Click-to-edit overlay on the live site, the versioned, origin-checked editor `postMessage` protocol, and `mostoField()` for annotations. No dependencies. | in progress |
| [`@mosto-cms/admin`](packages/admin) | The `/admin` UI: visual mode, forms, history and undo, uploads with in-browser compression, languages side by side; English and Italian; works on phones. | in progress |
| [`@mosto-cms/auth`](packages/auth) | Editor sign-in with email and password (no GitHub account), scoped and revocable connector keys. No database. | in progress |
| `mosto-cms` (CLI) | `npx mosto-cms init` for an existing site. | planned |

## The protocol

The heart of the project is the open content protocol. Read the spec in
[`docs/protocol.md`](docs/protocol.md), the credential design in [`docs/auth.md`](docs/auth.md),
and try it with the draft [getting-started guide](docs/getting-started.md) or the
[`examples/starter`](examples/starter) app.

## Development

Requires Node.js 22 (see `.nvmrc`) and pnpm 9.

```sh
pnpm install
pnpm test        # Vitest
pnpm typecheck
pnpm lint
pnpm guard       # repository hygiene: no secrets, no AI/agent code
pnpm build       # build the packages (the example apps import the built files)
pnpm test:e2e    # build examples/starter, run its end-to-end tests (HTTP and a headless browser)
```

Inside the repository, tests and type checks read the packages' TypeScript sources through the
`mosto-cms-source` export condition; apps (the starter, or a site using the published
packages) read the built `dist` files.

The browser end-to-end test drives `/admin` with headless Chromium through `playwright-core`.
Install the browser once with `pnpm exec playwright-core install chromium` (CI does it with
`--with-deps`); set `MOSTO_CMS_SCREENSHOTS=<dir>` to save a screenshot of every screen.

Versioning uses [changesets](https://github.com/changesets/changesets): add one with
`pnpm changeset` in any PR that changes a published package.

## Contributing

Pull requests are welcome. We use the Developer Certificate of Origin (a `Signed-off-by` line
in each commit), no CLA. See [CONTRIBUTING.md](CONTRIBUTING.md) and our
[Code of Conduct](CODE_OF_CONDUCT.md). To report a vulnerability privately, see
[SECURITY.md](SECURITY.md).

## License and name

Code: [MIT](LICENSE). Third-party notices: [THIRD_PARTY_NOTICES.md](THIRD_PARTY_NOTICES.md).
The MIT license covers the code, not the name: "Mosto CMS" and its logo identify the official
releases, see [TRADEMARK.md](TRADEMARK.md). The admin shows a small "Powered by Mosto CMS" link
that you can turn off.

Mosto CMS is made by [Mosto](https://mosto.studio), a design and web studio.

---

### Nota in italiano

Mosto CMS è un CMS open source (licenza MIT) che si installa nel repo del proprio sito: i
contenuti restano file JSON nel repo, chi modifica clicca direttamente sul sito, niente database
né server da pagare. Il progetto è in sviluppo iniziale. Documentazione e discussioni sono in
inglese, ma issue e domande in italiano sono benvenute.
