# Getting started (draft)

**Status:** draft. The packages are not on npm yet; until then, try the
[`examples/starter`](../examples/starter) app inside this repository. The `/admin` editing
interface and the `npx mosto-cms init` command come in later releases: today `/admin` is the
sign-in page and the content endpoint is complete.

This guide makes an existing Next.js (App Router) site editable. You need Node.js 22.

## 1. Install

```sh
npm install @mosto-cms/core @mosto-cms/auth @mosto-cms/next @mosto-cms/adapter-fs @mosto-cms/adapter-github
```

## 2. Put the content in JSON files

Move the texts and images you want editable into JSON files in your repo, for example
`content/home.json`:

```json
{
  "id": "home",
  "en": { "hero": { "title": "Fresh pasta, made every morning", "subtitle": "A small kitchen in the old town." } },
  "hero": { "image": "/hero.jpg" }
}
```

A file is either one entry (`single`: a page, the settings) or an array of entries (`list`:
products, boats, tours).

## 3. Declare what can change

`mosto-cms.schema.json` at the repository root lists every editable field. Anything not
listed is refused by the server ([spec](protocol.md#14-the-fence)).

```json
{
  "$schema": "https://raw.githubusercontent.com/mosto-cms/mosto-cms/main/packages/core/schema.json",
  "version": 1,
  "locales": ["en"],
  "collections": [
    {
      "key": "home",
      "file": "content/home.json",
      "idField": "id",
      "type": "single",
      "label": "Home page",
      "fields": [
        { "path": "en.hero.title", "kind": "text", "label": "Headline", "required": true, "maxLength": 80 },
        { "path": "en.hero.subtitle", "kind": "multiline", "label": "Subtitle" },
        { "path": "hero.image", "kind": "image", "label": "Hero image" }
      ]
    }
  ]
}
```

## 4. Wire it

`mosto-cms.config.ts`:

```ts
import { createFsAdapter } from '@mosto-cms/adapter-fs';
import { githubAdapterFromEnv } from '@mosto-cms/adapter-github';
import { createContentReader, defineMostoCms, fsSource, githubSourceFromEnv } from '@mosto-cms/next';

import home from './content/home.json';
import schema from './mosto-cms.schema.json';

// GitHub in production (MOSTO_CMS_GITHUB_REPO set), the local files in development.
export const cms = defineMostoCms({
  schema,
  adapter: (env) => githubAdapterFromEnv(env) ?? createFsAdapter({ root: process.cwd() }),
});

export const content = createContentReader({
  schema,
  source: () => githubSourceFromEnv(process.env) ?? fsSource({ root: process.cwd() }),
  bundled: { 'content/home.json': home },
});
```

`app/api/mosto-cms/[[...route]]/route.ts`:

```ts
import { createRouteHandlers } from '@mosto-cms/next';
import { cms } from '@/mosto-cms.config';

const handlers = createRouteHandlers(cms);
export const GET = handlers.GET;
export const POST = handlers.POST;
export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';
```

`app/admin/[[...admin]]/page.tsx`:

```ts
import { adminMetadata, createAdminPage } from '@mosto-cms/next/admin';
import { cms } from '@/mosto-cms.config';

export const metadata = adminMetadata;
export const dynamic = 'force-dynamic';
export default createAdminPage(cms);
```

## 5. Read the content and annotate it

```tsx
import { content } from '@/mosto-cms.config';

export const revalidate = 3600; // a publish refreshes the page immediately anyway

export default async function Home() {
  const home = await content.entry<{ en: { hero: { title: string } } }>('home');
  return <h1 data-mosto-field="home:home:en.hero.title">{home?.en.hero.title}</h1>;
}
```

The reader returns the latest published content (GitHub through the Next.js cache, or the
disk) and falls back to the JSON bundled at build time if the live read fails: the CMS never
breaks the site. `data-mosto-field="<collection>:<id>:<path>"` is what the visual editor will
use to make the element clickable.

## 6. Editors and secrets

```sh
npx mosto-cms-auth secret            # → MOSTO_CMS_SECRET
npx mosto-cms-auth hash-password     # → the passwordHash of each editor
```

`.env.local` (and the same variables on your host):

```sh
MOSTO_CMS_SECRET=...
MOSTO_CMS_EDITORS='[{"email":"anna@example.com","name":"Anna","passwordHash":"scrypt.15.8.1...."}]'
```

Open `/admin` and sign in. Editors need no GitHub account.

## 7. Production on GitHub

Content is committed to your repository, one commit per publish:

```sh
MOSTO_CMS_GITHUB_REPO=your-org/your-site
MOSTO_CMS_GITHUB_BRANCH=main
MOSTO_CMS_GITHUB_TOKEN=...              # fine-grained token, contents: read and write, this repo only
# or a GitHub App you own: MOSTO_CMS_GITHUB_APP_ID, MOSTO_CMS_GITHUB_APP_PRIVATE_KEY
```

After a publish, `/api/mosto-cms` expires the cached content and pages, so the next visit
shows the change in seconds; your host also rebuilds from the new commit as usual.

**Private repository?** Uploaded images are not in the deployed bundle until the next build.
Serve them right away with the media proxy, and set `"media": { "publicPath": "/media" }` in
the schema:

```ts
// app/media/[...path]/route.ts
import { createMediaHandler, githubSourceFromEnv } from '@mosto-cms/next';
import schema from '@/mosto-cms.schema.json';

export const GET = createMediaHandler({ schema, source: () => githubSourceFromEnv(process.env) });
```

## 8. Connect a platform or a script

Create a scoped key and give it to the tool that needs it:

```sh
MOSTO_CMS_SECRET=... npx mosto-cms-auth create-key --write --label "My platform"
```

```sh
curl -X POST https://your-site.example/api/mosto-cms \
  -H "Authorization: Bearer mck1...." -H "Content-Type: application/json" \
  -d '{"op":"describe"}'
```

Revoke it any time: add its id (`npx mosto-cms-auth key-id <key>`) to `MOSTO_CMS_REVOKED_KEYS`
or to `mosto-cms.revoked.json` in the repo. Details in [auth.md](auth.md); every operation in
[protocol.md](protocol.md).
