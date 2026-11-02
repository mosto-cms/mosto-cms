# Security policy

Mosto CMS runs inside public websites (the `/admin` page and the `/api/mosto-cms` endpoint), so
we take reports seriously.

## Reporting a vulnerability

Please **do not open a public issue**. Report privately through GitHub:
**Security → Report a vulnerability** on this repository
(https://github.com/mosto-cms/mosto-cms/security/advisories/new).
If you cannot use GitHub, write to **info@mosto.studio** with "SECURITY" in the subject.

Include the affected package and version, a description of the issue and its impact, and steps
or a proof of concept to reproduce it.

## What to expect

- Acknowledgement within 3 working days.
- An assessment and a fix plan within 10 working days.
- A coordinated disclosure: we publish a GitHub Security Advisory and a patched release, and
  credit you if you wish.

## Supported versions

The project is pre-1.0. Only the latest published `0.x` release of each package receives
security fixes.

## Scope notes

Of particular interest: bypassing the field fence (writing a path not declared in the schema),
authentication of the admin and of connector keys, path traversal in adapters or uploads, and
cross-origin issues in the editor `postMessage` protocol.
