# @mosto-cms/next

[Mosto CMS](https://github.com/mosto-cms/mosto-cms) for Next.js (App Router, Node.js runtime):

- `defineMostoCms()`: one config object (schema, content adapter, secret, editors, keys).
- `createRouteHandlers()`: `POST /api/mosto-cms` for the `mosto-cms/1` protocol (connector
  key or editor session), plus sign-in, sign-out and session routes. Expires the cache of the
  changed content right after a publish.
- `createContentReader()`: live content (GitHub through the Next.js data cache, or the disk)
  with a silent fallback to the JSON bundled at build time.
- `createMediaHandler()`: optional proxy that serves uploads from a private repository.
- `@mosto-cms/next/admin`: the `/admin` page, the editing interface of `@mosto-cms/admin`.
- `@mosto-cms/next/overlay`: `<MostoOverlay />` for the root layout, the click-to-edit layer
  that wakes up only inside `/admin`.
- `mostoField()`: the annotation helper (`<h1 {...mostoField('home:home', 'en.title')}>`).

```ts
// mosto-cms.config.ts
export const cms = defineMostoCms({
  schema,
  adapter: (env) => githubAdapterFromEnv(env) ?? createFsAdapter({ root: process.cwd() }),
});

// app/api/mosto-cms/[[...route]]/route.ts
const handlers = createRouteHandlers(cms);
export const GET = handlers.GET;
export const POST = handlers.POST;
export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

// app/admin/[[...admin]]/page.tsx
export default createAdminPage(cms);

// app/layout.tsx
<body>{children}<MostoOverlay /></body>
```

Guide: [`docs/getting-started.md`](../../docs/getting-started.md). Working example:
[`examples/starter`](../../examples/starter).

MIT licensed.
