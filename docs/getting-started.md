# Getting started (draft)

**Status:** draft. The packages are published as alpha prereleases under the npm `next` tag
(no stable release yet); the [`examples/starter`](../examples/starter) app in this repository
shows a complete setup. The `npx mosto-cms init` command comes in a later release.

This guide makes an existing Next.js (App Router, 15 or 16) site editable. You need Node.js 22.

## 1. Install

```sh
npm install @mosto-cms/core@next @mosto-cms/auth@next @mosto-cms/next@next @mosto-cms/admin@next @mosto-cms/overlay@next @mosto-cms/adapter-fs@next @mosto-cms/adapter-github@next
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
  // Optional: the pages offered in the visual editor (default: the home page).
  admin: { pages: [{ path: '/', label: 'Home' }, { path: '/menu', label: 'Menu' }] },
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
import { mostoField } from '@mosto-cms/next';

export const revalidate = 3600; // a publish refreshes the page immediately anyway

export default async function Home() {
  const home = await content.entry<{ en: { hero: { title: string } }; hero: { image: string } }>('home');
  return (
    <>
      <h1 {...mostoField('home:home', 'en.hero.title')}>{home?.en.hero.title}</h1>
      <img {...mostoField('home:home', 'hero.image')} src={home?.hero.image} alt="" />
    </>
  );
}
```

The reader returns the latest published content (GitHub through the Next.js cache, or the
disk) and falls back to the JSON bundled at build time if the live read fails: the CMS never
breaks the site. `mostoField(entry, path, index?)` returns the `data-mosto-field` attribute
(`<collection>:<id>:<path>`) the visual editor uses; pass an index for one item of a list
(`mostoField('fleet:libeccio', 'gallery', 2)` → `fleet:libeccio:gallery.2`) and
`{ kind: 'image' }` when it cannot be inferred from the tag. In client components import it
from `@mosto-cms/overlay`.

Then add the overlay once, in the root layout. It renders nothing and does nothing for
visitors; it only wakes up inside `/admin`:

```tsx
// app/layout.tsx
import { MostoOverlay } from '@mosto-cms/next/overlay';

export default function RootLayout({ children }: { children: React.ReactNode }) {
  return (
    <html lang="en">
      <body>
        {children}
        <MostoOverlay />
      </body>
    </html>
  );
}
```

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

Open `/admin` and sign in. Editors need no GitHub account. They get three modes:

- **On the page**: the site in a frame; click a text or a photo, change it in the side panel
  (a bottom sheet on phones), see it change on the page as they type, then **Publish**.
- **All content**: every editable field as a form, grouped by page or list, with the site's
  languages side by side.
- **History**: the recent publishes, each with **Undo** (needs GitHub, or `git: true` on the
  fs adapter locally).

Photos are compressed in the browser before upload (longest side 2400 px, WebP when the site
accepts it); every file must stay under `media.maxBytes` (10 MB by default). The interface is
in English and Italian, following the browser, and can be switched from the account menu.
`defineMostoCms({ admin: { poweredBy: false } })` hides the "Powered by Mosto CMS" link.

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

## 8. Before going live

- **SVG uploads are off by default.** An SVG can contain script and uploads are served from
  your own domain. To allow them, list `"image/svg+xml"` in `media.accept`, only for editors
  you trust. The media route serves SVGs with a sandboxing Content-Security-Policy; files
  served straight from `public/` get no such protection.
- **Sign-in attempt limits on serverless.** The default limiter counts in memory, so on
  Vercel or Netlify each function instance counts on its own: a brake, not a global cap. For
  a global limit pass a shared store (Redis, Vercel KV, Upstash…) implementing
  `RateLimitStore` from `@mosto-cms/auth`:

  ```ts
  defineMostoCms({
    schema,
    adapter,
    rateLimit: {
      store: {
        async get(key) { return (await kv.get(`mosto:${key}`)) ?? null; },
        async increment(key, windowMs) { /* add one, start a window of windowMs if none */ },
        async reset(key) { await kv.del(`mosto:${key}`); },
      },
    },
  });
  ```
- **Upload size on Vercel.** Functions accept request bodies up to about 4.5 MB, so larger
  videos cannot be uploaded through `/api/mosto-cms` there; compress them first or host them
  elsewhere and paste the address.
- **Framing.** `/admin` shows your pages in an `<iframe>` from the same origin. If your site
  sends `X-Frame-Options: DENY` or `Content-Security-Policy: frame-ancestors 'none'`, allow
  `'self'` for the visual editor to work.

## 9. Connect a platform or a script

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
