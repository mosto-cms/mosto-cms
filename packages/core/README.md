# @mosto-cms/core

The engine of [Mosto CMS](https://github.com/mosto-cms/mosto-cms): the `mosto-cms/1` schema
format and its validation, field addresses, the field fence and the protocol operations.
No dependencies, runs anywhere `fetch`-era JavaScript runs.

```ts
import { createCms, loadSchema, handleRequest } from '@mosto-cms/core';
import { createGithubAdapter } from '@mosto-cms/adapter-github';

const cms = createCms({
  schema: loadSchema(schemaJson),
  adapter: createGithubAdapter({ owner, repo, branch: 'main', auth: { token } }),
  access: { write: true },
});

await cms.publish({
  message: 'New spring prices',
  changes: [{ collection: 'tours', id: 'giro-isola', path: 'price', value: '€ 140' }],
});

// or, behind an HTTP route:
const { status, body } = await handleRequest(cms, await request.json());
```

- Spec: [`docs/protocol.md`](../../docs/protocol.md)
- JSON Schema for `mosto-cms.schema.json`: `@mosto-cms/core/schema.json`
- `createMemoryAdapter()` gives an in-memory store with history, handy in tests.

MIT licensed.
