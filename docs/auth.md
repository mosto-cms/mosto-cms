# Authentication and connector keys

**Status:** draft for v0, implemented by `@mosto-cms/auth` and `@mosto-cms/next`.

A Mosto CMS site has no database, so every credential is either configured by the site owner
(editors) or signed with the site's own secret (sessions, connector keys). Nothing here needs
an external service.

## 1. The site secret

`MOSTO_CMS_SECRET`: a random string of at least 32 characters, only in the site's environment
(`mosto-cms-auth secret` prints one). It never leaves the server and is never returned by an
operation.

Every use gets its own 32-byte subkey through HKDF-SHA256 (`salt = "mosto-cms"`):

| Purpose | HKDF `info` |
|---|---|
| Editor sessions | `session/v1` |
| Connector keys | `connector-key/v1/epoch:<MOSTO_CMS_KEY_EPOCH, default 0>` |

So a session token can never be presented as a key (different subkey and prefix), and
bumping the key epoch revokes every connector key without signing editors out. Rotating the
secret itself ends everything at once.

Tokens share one format: `<prefix>.<base64url(JSON payload)>.<base64url(HMAC-SHA256)>`. The
HMAC covers `<prefix>.<payload>`; signatures are compared in constant time.

## 2. Editors

Editors are a short list configured by the owner, in `MOSTO_CMS_EDITORS` (or passed in code):

```sh
MOSTO_CMS_EDITORS='[{"email":"anna@example.com","name":"Anna","passwordHash":"scrypt.15.8.1.<salt>.<hash>"}]'
```

- **Hashes:** scrypt, `N = 2^15, r = 8, p = 1`, 16-byte random salt, 32-byte key. Stored as
  `scrypt.<log2 N>.<r>.<p>.<salt>.<hash>` (base64url). Dots, not `$`: env loaders (Next.js
  included) expand `$…` and would corrupt a `$`-separated hash. Make one with
  `mosto-cms-auth hash-password` (hidden prompt or stdin, never a command-line argument).
  Passwords are 10 to 1024 characters, normalized with NFKC.
- **Sign-in:** `POST /api/mosto-cms/login` with JSON `{ email, password }` or a form. Emails
  are compared case-insensitively. An unknown email still runs one full scrypt check against a
  dummy hash, and both failures return the same `401`, so the endpoint does not reveal who is
  an editor.
- **Attempt limits:** failed sign-ins are counted per email (5) and per client IP (20) in
  15-minute windows. Over the limit, sign-in is refused with `429` and `Retry-After`, even
  with the right password, until the window ends. A success resets the email counter. The
  default store is in memory: on serverless hosting each instance counts on its own, so it is
  a brake (each guess also costs a scrypt hash of about 60 ms), not a global cap. Pass a shared
  `RateLimitStore` (Redis, KV…) for a global one. The IP comes from `X-Forwarded-For` (first
  hop) or `X-Real-IP`, so it is only as trustworthy as the host's proxy.
- **Session:** a token `mcs1.<payload>.<sig>` with `{ v: 1, sub: email, name, iat, exp, ph }`,
  default lifetime 12 hours. `ph` is an HMAC (session subkey) of the editor's password hash:
  removing an editor from the list or changing their password ends their sessions at the next
  request, with no session store.
- **Cookie:** `__Host-mosto-cms-session` over HTTPS (the `__Host-` prefix forces `Secure`,
  `Path=/` and no `Domain`), `mosto-cms-session` on plain-HTTP local development. Always
  `HttpOnly; SameSite=Strict; Path=/`.
- **Sign-out:** `POST /api/mosto-cms/logout` deletes the cookie. A stolen session token stays
  valid until it expires unless the password or the secret changes: keep the lifetime short.

## 3. Cross-site requests

Cookie-authenticated calls are protected three ways:

1. `SameSite=Strict`: browsers do not send the cookie on requests started by other sites.
2. Protocol calls with a cookie MUST be `Content-Type: application/json`, which a cross-site
   form cannot send without a CORS preflight (and the endpoint answers no CORS).
3. When the browser sends `Origin`, it must be the site itself or one of
   `MOSTO_CMS_ALLOWED_ORIGINS`; otherwise `403 forbidden`. Sign-in and sign-out check it too.

Connector keys travel in the `Authorization` header, which browsers never add on their own, so
they need none of this.

## 4. Connector keys

A connector key lets a platform or a script call `POST /api/mosto-cms` with a limited scope.

```
mck1.<base64url(json)>.<base64url(hmac-sha256)>
json = { "v": 1, "kid": "<16 chars>", "w": false, "c": ["fleet"], "a": "human", "iat": 1793650000, "exp": 1801426000, "l": "Mosto" }
```

| Claim | Meaning |
|---|---|
| `kid` | Random key id (12 bytes, base64url). The handle used to revoke the key; safe to show and log. |
| `w` | Write allowed (`publish`, `uploadAsset`, `revert`). Keys are read-only unless created with `--write`. |
| `c` | Collections allowed. Absent: all. |
| `a` | Actor, `human` or `ai`. An `ai` key cannot write fields marked `ai.locked`. |
| `iat`, `exp` | Issued at, optional expiry (unix seconds). |
| `l` | Optional label, used as the commit author name (`<label> (connector)`). |

- **Verification** needs only the secret and the revocation list: prefix, HMAC (constant time),
  claim types, expiry, revocation. Any failure is `401 unauthorized` with
  `details.reason` = `malformed`, `bad_signature`, `expired` or `revoked`.
- **Scope:** the claims become the protocol access scope (`write`, `collections`, `actor`), so
  the core enforces them the same way for every operation. A caller may send
  `X-Mosto-Actor: ai` to act as AI with a human key; it can never raise its rights.
- **Precedence:** if an `Authorization` header is present the request is judged on it alone;
  a bad key never falls back to the editor cookie.
- **Creating a key:** `MOSTO_CMS_SECRET=… mosto-cms-auth create-key --write --label "Mosto"`
  (options: `--collections a,b`, `--actor ai`, `--expires-days 90`), or `createConnectorKey()`.
  The key is shown once; store it like a password. `/admin` will get a "Connect" screen for
  this in a later release.
- **Revoking one key:** add its id (`mosto-cms-auth key-id <key>`) to any of:
  - `MOSTO_CMS_REVOKED_KEYS` (comma separated), effective after the next deploy/restart;
  - `keys.revoked` in the site config;
  - the revocation file `mosto-cms.revoked.json` at the repository root,
    `{ "revoked": ["<kid>", …] }`, read through the content adapter (so on GitHub: the
    latest commit on the content branch, no redeploy) and cached 30 seconds per instance.
    It is outside the schema, so no protocol operation can write it: a key cannot un-revoke
    itself. If the file is not valid JSON, every key is refused until it is fixed.
- **Revoking all keys:** bump `MOSTO_CMS_KEY_EPOCH`. Editor sessions are unaffected.

What a revoked or expired key never affects: the public site, `/admin` and editor sessions.

## 5. What is not here (yet)

Roles and invitations, per-editor permissions, password reset by email and two-factor sign-in
are outside v1: editors are a few people set up by the owner. Sites that need them can put
their own login in front and build the protocol access themselves.
