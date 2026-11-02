# The `mosto-cms/1` protocol

**Status:** draft for v0, implemented by `@mosto-cms/core`. Breaking changes before `1.0` are
possible and will be listed in the changelog.

`mosto-cms/1` is the contract between a website and anything that edits its content: the
site's own `/admin`, a platform connected with a key, a script, an AI client. It has five parts:

1. a **schema** that declares the editable fields (the fence);
2. a **field address** format;
3. the **operations** (seven, plus `history` and `revert`);
4. an **HTTP transport** with standard errors;
5. the **visual editor messages** exchanged between the admin and the site page.

The words MUST, SHOULD and MAY are used as in RFC 2119.

---

## 1. Schema

The schema lives at the root of the site repository as `mosto-cms.schema.json`. It can be
written in TypeScript with `defineSchema()` and emitted as JSON; the JSON file is the source
that every client reads. A JSON Schema for editors is published at
`packages/core/schema.json`.

```json
{
  "$schema": "https://raw.githubusercontent.com/mosto-cms/mosto-cms/main/packages/core/schema.json",
  "version": 1,
  "site": { "name": "Capri Boats", "url": "https://example.com" },
  "locales": ["it", "en"],
  "defaultLocale": "it",
  "media": { "dir": "public/uploads", "publicPath": "/uploads", "maxBytes": 10485760 },
  "collections": [
    {
      "key": "content",
      "file": "app/data/content.json",
      "idField": "id",
      "type": "single",
      "label": { "it": "Testi del sito", "en": "Site copy" },
      "fields": [
        {
          "path": "it.hero.title",
          "kind": "text",
          "label": { "it": "Titolo hero", "en": "Hero title" },
          "required": true,
          "maxLength": 60,
          "ai": { "instructions": "Elegant tone, at most 8 words." }
        },
        { "path": "hero.video", "kind": "video", "label": "Hero video", "accept": ["video/mp4"] }
      ]
    },
    {
      "key": "fleet",
      "file": "app/data/fleet.json",
      "idField": "slug",
      "type": "list",
      "titleField": "{locale}.name",
      "label": { "it": "Flotta", "en": "Fleet" },
      "fields": [
        { "path": "gallery", "kind": "imageList", "label": "Gallery", "maxItems": 12 },
        { "path": "price", "kind": "text", "label": "Price", "ai": { "locked": true } }
      ]
    }
  ]
}
```

### 1.1 Top level

| Property | Required | Meaning |
|---|---|---|
| `version` | yes | Always `1` for this protocol. |
| `locales` | yes | Locale codes of the site, at least one, no duplicates. |
| `defaultLocale` | no | One of `locales`. Default: the first locale. |
| `site` | no | `{ name, url }`, informational. |
| `media` | no | Where uploads go. `dir`: repository directory; `publicPath`: URL prefix the site serves it from; `maxBytes` (default 10 MB); `accept` (MIME types, default common web images and mp4/webm). Default `{ "dir": "public/uploads", "publicPath": "/uploads" }`. |
| `collections` | yes | The editable collections. |

### 1.2 Collections

| Property | Required | Meaning |
|---|---|---|
| `key` | yes | Unique, `[A-Za-z0-9_-]+`. Used in field addresses. |
| `file` | yes | JSON file relative to the repository root. Safe relative path (no leading `/`, no `..`), ending in `.json`. |
| `idField` | yes | Property holding the entry id. |
| `type` | yes | `list` (a JSON array of entries: boats, tours, products) or `single` (one entry: home page, settings). A `single` file is a JSON object or an array with exactly one entry; if the entry has no `idField` value, its id is the collection `key`. |
| `label`, `description` | `label` yes | A string, or a map locale → string. |
| `titleField` | no | Path of the entry title shown in lists. `{locale}` is replaced by the requested locale. Without it, clients use `<locale>.name`, `<locale>.title`, `name`, `title`, then the id. |
| `fields` | yes | The editable fields. |

### 1.3 Fields

| Property | Required | Meaning |
|---|---|---|
| `path` | yes | Dot-path inside an entry: `it.hero.title`, `specs.length`, `gallery`. Unique in the collection. Segments `__proto__`, `prototype`, `constructor` are forbidden. |
| `kind` | yes | See below. |
| `label`, `description` | `label` yes | String or locale map. |
| `required` | no | The value cannot be empty (blank string or empty list). |
| `maxLength` | no | Max characters (Unicode code points) of a string, or of each list item. |
| `maxItems` | no | Max items of a list kind. |
| `accept` | no | MIME types accepted for uploads into this field. |
| `ai.instructions` | no | Free-text guidance for AI clients ("elegant tone, max 8 words"). |
| `ai.locked` | no | When `true`, callers acting as AI MUST NOT write the field (enforced server-side, see 3.1). |

Kinds in v1:

| Kind | Value | Notes |
|---|---|---|
| `text` | string | Single line. |
| `multiline` | string | Line breaks allowed. |
| `image` | string | URL or path of an image. Single line. |
| `video` | string | URL or path of a video. Single line. |
| `url` | string | A link. Single line. |
| `list` | string[] | A list of short texts. |
| `imageList` | string[] | A gallery. |

For every string kind except `multiline`, line breaks are invalid. Control characters are
always invalid. `image`, `video`, `url` and `imageList` values MUST NOT use the `javascript:`,
`vbscript:` or `data:` schemes. Planned for v2: `richtext`, `number`, `boolean`, `date`,
`select`, `object`.

**Locales.** A field whose first path segment is one of `locales` belongs to that locale
(`it.hero.title`). Other fields are shared (`hero.video`, `price`). Clients MAY show locales
side by side using this rule.

### 1.4 The fence

The schema is a fence, not documentation. A server implementing this protocol MUST refuse any
read or write of a path that does not resolve to a declared field, with `field_not_editable`,
whatever the client. A path resolves when:

- it equals a declared field `path`; or
- it is `<path>.<n>` where `<path>` is a declared `list` or `imageList` field and `<n>` a
  non-negative integer: it targets one item (kind `text` for `list`, `image` for `imageList`)
  and inherits the parent's `maxLength`, `accept`, `required` and `ai`. The item MUST already
  exist (`invalid_value` otherwise): item paths edit, they do not append.

Everything else in a content file (ids, structure, layout data, undeclared keys) is never
returned by `getField` on a whole entry and never written.

### 1.5 Legacy format

Schemas written before v1 (`mosto-edit.schema.json`: `{ "collections": [...] }`, no `version`,
no `locales`, no `type`) are accepted by `loadSchema()` and converted: locales are inferred from
the label keys, every collection becomes `list` unless told otherwise. The conversion is
lossless and reversible (`toLegacySchema`).

---

## 2. Field addresses

```
<collection>:<id>:<path>
```

Examples: `content:home:it.hero.title`, `fleet:libeccio:cover`, `fleet:libeccio:gallery.2`.
The collection key and the id MUST NOT contain `:`; the path is everything after the second
`:`. The same string is used in page annotations (`data-mosto-field`), in protocol inputs
(split into `collection`, `id`, `path`) and in editor messages.

---

## 3. Operations

All operations take one JSON object as input and return one JSON object. They are stateless:
nothing is kept between calls, so they run as serverless functions.

| Operation | Input | Result | Writes |
|---|---|---|---|
| `describe` | `{}` | protocol, schema version, site, locales, default locale, collections (key, type, label, number of fields), capabilities, upload limits (`media`: public path, max bytes, accepted types), the caller's access, operation names | no |
| `listEditableFields` | `{ collection? }` | `[{ key, type, label, idField, file, fields }]` with full field definitions | no |
| `listEntries` | `{ collection, locale? }` | `[{ id, title }]` | no |
| `getField` | `{ collection, id, path? }` | with `path`: `{ collection, id, path, kind, value, revision }`; without: `{ collection, id, revision, fields: { <path>: value } }` (declared fields only) | no |
| `previewChange` | `{ changes: Change[] }` | `{ changes: ChangeResult[], revisions: { <file>: <revision> } }` | no |
| `publish` | `{ changes: Change[], message?, baseRevisions? }` | `{ published, revision, url?, files, changes: ChangeResult[] }` | yes, one commit |
| `uploadAsset` | `{ filename, contentType, dataBase64, field? }` | `{ path, file, bytes, revision }` | yes, one commit |
| `history` | `{ limit?, collection? }` | `{ entries: [{ revision, parent, message, author, date, files }] }`, newest first, `limit` 1-100 (default 20) | no |
| `revert` | `{ revision, message?, force? }` | as `publish`, plus `reverted` | yes, one commit |

```ts
type FieldValue = string | string[];
type Change = { collection: string; id: string; path: string; value: FieldValue; before?: FieldValue };
type ChangeResult = {
  collection: string; id: string; path: string; kind: string;
  before: FieldValue | null; after: FieldValue; changed: boolean;
};
```

### 3.1 Rules

- **Fence and values.** Every change is resolved against the schema (`field_not_editable`) and
  validated (`invalid_value`) before anything is written. One invalid change fails the whole
  call. The same field twice in one call is `bad_request`.
- **Atomic publish.** `publish` applies all changes in ONE revision (one git commit), even
  across several files, or none. If no value actually changes, nothing is committed and
  `published` is `false`.
- **Conflicts.** A change MAY carry `before`, the value the caller last saw; if the field holds
  something else now, `conflict`. `publish` MAY carry `baseRevisions` (as returned by
  `previewChange`); if any of those files changed since, `conflict` (strict mode). Without
  either, a concurrent commit to the same file is detected by the storage, the server re-reads
  and applies the changes again once, and never overwrites a field whose `before` no longer
  matches.
- **Uploads.** `contentType` MUST be in the field's `accept` (when `field` is given) or in the
  schema's media `accept`; otherwise `unsupported`. Size above `maxBytes` is `too_large`. The
  file is committed under `media.dir` with a new unique name derived from `filename`, and MUST
  NOT overwrite an existing file. The returned `path` (under `media.publicPath`) is the value
  to publish in an `image`/`video`/`imageList` field.
- **History and revert.** Available when the storage supports history (`describe` →
  `capabilities`). `revert` restores, field by field, every declared field the given revision
  changed; it never touches content outside the fence, and entries created or removed by that
  revision are out of scope in v1. If a field was changed again later, `conflict`, unless
  `force: true`.
- **Access.** A caller has an access scope: `write` (default true), `collections` (default
  all) and `actor` (`human` or `ai`). Writes with a read-only scope and collections outside
  the scope are `forbidden`. A caller with `actor: "ai"` writing an `ai.locked` field gets
  `field_not_editable` with `details.reason = "ai_locked"`. `describe` returns the scope.

### 3.2 Mapping to MCP tools

Each operation maps 1:1 to a tool of an MCP bridge built on top of this protocol (not part of
this repository): `describe` → `cms_whoami`, `listEditableFields` → `cms_list_editable_fields`,
`listEntries` → `cms_list_entries`, `getField` → `cms_get_field`, `previewChange` →
`cms_preview_change`, `publish` → `cms_publish`, `uploadAsset` → `cms_upload_asset`.

---

## 4. HTTP transport

One route on the site:

```
POST /api/mosto-cms
Content-Type: application/json
Authorization: Bearer <connector key>        (or the editor session cookie, for /admin)

{ "op": "publish", "input": { "message": "New spring prices", "changes": [ ... ] } }
```

Responses always use this envelope:

```json
{ "ok": true, "protocol": "mosto-cms/1", "result": { } }
```

```json
{ "ok": false, "protocol": "mosto-cms/1", "error": { "code": "field_not_editable", "message": "...", "details": { } } }
```

### 4.1 Errors

| Code | HTTP | When |
|---|---|---|
| `bad_request` | 400 | Malformed body, unknown `op`, missing or mistyped input. |
| `unauthorized` | 401 | No credentials, or an invalid, expired or revoked key. |
| `forbidden` | 403 | Valid credentials, but the action is outside their scope (read-only key, collection not allowed). |
| `field_not_editable` | 403 | The path is not declared in the schema, or it is `ai.locked` for an AI caller. |
| `not_found` | 404 | Unknown collection, entry, content file or revision. |
| `conflict` | 409 | The content changed since the caller read it. Re-read and retry. |
| `too_large` | 413 | Upload over `maxBytes`, or too many changes in one call (max 500). |
| `invalid_value` | 422 | The value does not fit the field. |
| `unsupported` | 422 | Unsupported media type, or an operation the storage cannot do (history on a plain file system). |
| `invalid_schema` | 500 | The site's schema file is invalid; `details.issues` lists every problem. |
| `internal` | 500 | Anything else, including the storage refusing the site's own credentials. |

Clients MUST branch on `code`, never on `message`.

### 4.2 Authentication

Full design: [`docs/auth.md`](auth.md). In short:

- **Connector keys** (`Authorization: Bearer mck1.…`) let a platform or a script call the
  endpoint. A key carries a scope (`write`, `collections`, `actor`), is verified without a
  database (HMAC with a subkey of the site secret), and can be revoked by the site owner at any
  time; a revoked key gets `unauthorized` with `details.reason = "revoked"`, while the site
  and `/admin` keep working. When an `Authorization` header is present, the request is judged
  on it alone.
- **Editors** sign in to `/admin` with an email and a password configured for the site; no
  GitHub account. The session is a signed, `HttpOnly`, `SameSite=Strict` cookie (`Secure`
  over HTTPS); sign-in attempts are rate limited. Protocol calls made with the cookie MUST be
  `application/json` and, when the browser sends `Origin`, come from the site itself or an
  explicitly allowed origin (`forbidden` otherwise).
- `X-Mosto-Actor: ai` makes a caller act as AI (it can then not write `ai.locked` fields). It
  can only lower the caller's rights.
- The storage credentials (a GitHub token or the owner's GitHub App) stay on the site, in its
  environment. They are never returned by any operation.

### 4.3 Companion routes

An implementation MAY serve these next to the protocol route (the Next.js integration does):

| Route | Purpose |
|---|---|
| `GET /api/mosto-cms` | Discovery, no auth: `{ name: "mosto-cms", protocol, auth: ["connector-key", "editor-session"] }`. |
| `POST /api/mosto-cms/login` | Editor sign-in: JSON `{ email, password }` → `200` + cookie, `401` or `429`; or a form → `303` redirect. |
| `POST /api/mosto-cms/logout` | Editor sign-out. |
| `GET /api/mosto-cms/session` | `{ editor: { email, name } \| null, expiresAt? }` for the current cookie. |

They use the same envelope; a locked sign-in answers `429` with code `unauthorized` and
`details.reason = "locked"`.

### 4.4 Limits

- At most 500 changes per call (`too_large`).
- The request body is limited to the base64 size of `media.maxBytes` plus 64 KB (`too_large`).
  Hosting platforms have their own limits (about 4.5 MB on Vercel functions), so large videos
  may need to go through a platform's storage in a later version.
- After a successful `publish` or `revert`, the Next.js integration expires the cache of the
  changed files and of the rendered pages, so the next visit shows the new content.

---

## 5. Visual editor messages

The admin shows the site in an `<iframe>` with `?mostoEdit=1`. A small overlay script on the
site (`@mosto-cms/overlay`) highlights annotated elements and talks to the admin with
`window.postMessage`. Annotate elements like this (or with `mostoField()`):

```html
<h1 data-mosto-field="content:home:it.hero.title">Benvenuti</h1>
<img data-mosto-field="fleet:libeccio:gallery.2" data-mosto-kind="image" src="..." />
<video data-mosto-field="content:home:hero.video" data-mosto-kind="video" src="..."></video>
```

`data-mosto-kind` is optional for `<img>` and `<video>` (inferred) and defaults to `text`.
One item of a list field is addressed by its index (`gallery.2`). When several annotated
elements are stacked at the clicked point (the frames of a carousel), the overlay selects the
most visible one; a non-annotated element on top (a carousel arrow) keeps the click.

### 5.1 Messages

Every message is an object with `type` and `v` (protocol message version, `1`).

| Direction | `type` | Payload |
|---|---|---|
| site → admin | `mosto:overlay-loaded` | none. Sent once when the overlay starts, to `window.parent`, addressed to each allowed admin origin (the browser delivers it only if the parent has one of them). The only message sent before the handshake. |
| admin → site | `mosto:init` | `{ locale? }` |
| site → admin | `mosto:ready` | `{ fields: number, url?: string }` (annotated elements found; the page path without `mostoEdit`) |
| site → admin | `mosto:select` | `{ field: { collection, id, path, kind }, value, rect: { top, left, width, height } }` |
| admin → site | `mosto:set` | `{ field: { collection, id, path, kind }, value }`: optimistic, in-place update of the page. A list value also updates the elements annotated per item (`<path>.<i>`). |
| admin → site | `mosto:highlight` | `{ field \| null }`: scroll to and outline a field, or clear the outline |

### 5.2 Origin checks

- The overlay activates only when `?mostoEdit=1` is present AND the page is inside a frame,
  and stays passive (no highlight, no click capture) until a valid `mosto:init` arrives.
- The site MUST only accept `mosto:init` from `window.parent` and from an allowed admin origin: by default the site's own
  origin (the `/admin` page); additional origins (for example a connected platform) are listed
  explicitly in the site configuration. Messages from any other origin are ignored.
- After the handshake the site sends every message to that exact origin, never `*`, and ignores
  messages from other origins.
- The admin MUST check that messages come from the iframe's window and the site's origin.
- `mosto:set` only changes the page shown in the editor. Nothing is saved until the admin calls
  `publish`, where the server applies the fence again.

---

## 6. Versioning

- The protocol string is `mosto-cms/<major>`. Additive changes (new optional inputs, new
  result fields, new operations, new error details) keep the major version; clients MUST
  ignore unknown result fields.
- The schema carries its own `version`. A server MUST reject a schema version it does not know
  with `invalid_schema`.
- Editor messages carry `v`; a side receiving a higher `v` than it supports SHOULD ignore the
  message.
