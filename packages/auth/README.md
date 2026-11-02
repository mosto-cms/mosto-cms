# @mosto-cms/auth

Credentials for a [Mosto CMS](https://github.com/mosto-cms/mosto-cms) site, with no database
and no external service:

- **Editor sign-in** with email and password: scrypt hashes in the site config, a signed
  `HttpOnly`, `SameSite=Strict` session cookie, attempt limits, sign-out. Framework-agnostic
  handlers on Web `Request`/`Response`.
- **Connector keys**: scoped (read/write, collections, human or AI), signed with the site
  secret so they verify without storage, revocable one by one (revocation list) or all at once
  (key epoch).

```ts
import { createEditorAuth, createConnectorKey, verifyConnectorKey, editorsFromEnv } from '@mosto-cms/auth';

const auth = createEditorAuth({ secret: process.env.MOSTO_CMS_SECRET!, editors: () => editorsFromEnv(process.env) });
// auth.handleLogin(request), auth.handleLogout(request), auth.getSession(request)

const { key, kid } = createConnectorKey({ secret, write: true, collections: ['fleet'], label: 'Platform' });
verifyConnectorKey(key, { secret, revoked: ['<revoked kid>'] }); // { ok: true, claims } or { ok: false, reason }
```

CLI (`mosto-cms-auth`): `secret`, `hash-password`, `create-key [--write] [--collections a,b]
[--actor ai] [--label x] [--expires-days n]`, `key-id <key>`.

Design and threat model: [`docs/auth.md`](../../docs/auth.md). Node.js only (uses `node:crypto`).

MIT licensed.
