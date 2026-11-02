# Contributing to Mosto CMS

Thanks for helping. This project is small on purpose: a lean core, a clear protocol and a few
packages. Contributions that keep it that way are the easiest to accept.

## Before you start

- **Bugs:** open an issue with steps to reproduce, the package and version, and what you
  expected.
- **Features:** open an issue first to discuss scope. Large changes to the protocol
  (`docs/protocol.md`) need agreement before code, because every client depends on it.
- **Security issues:** do not open a public issue. Follow [SECURITY.md](SECURITY.md).

## Development setup

```sh
nvm use            # Node.js 22, pinned in .nvmrc
corepack enable    # pnpm version pinned in package.json
pnpm install
pnpm test && pnpm typecheck && pnpm lint && pnpm guard
pnpm build && pnpm test:e2e   # when you touch @mosto-cms/next, @mosto-cms/auth or the starter
```

## Pull requests

1. Branch from `main`, keep the PR focused on one change.
2. Add or update tests. The core must stay covered on addressing, the fence and conflicts.
3. Add a changeset (`pnpm changeset`) when you change a published package.
4. Update `docs/protocol.md` if behaviour visible through the protocol changes.
5. Make sure CI is green.

### What does not belong in this repository

To keep the core neutral and safe to install on any site, the CI guard rejects:

- credentials, tokens, private keys or `.env` files;
- AI agent code, LLM SDKs or prompts. The protocol is designed to be driven by any client,
  including AI tools, but those clients live outside this repository.

## Developer Certificate of Origin (DCO)

We do not use a CLA. Instead, every commit must be signed off, certifying that you wrote the
change or otherwise have the right to submit it under the MIT license. Add the sign-off with:

```sh
git commit -s -m "your message"
```

which appends a line like:

```
Signed-off-by: Your Name <you@example.com>
```

The sign-off means you agree to the Developer Certificate of Origin 1.1, reproduced below
(also at https://developercertificate.org):

```
Developer Certificate of Origin
Version 1.1

Copyright (C) 2004, 2006 The Linux Foundation and its contributors.

Everyone is permitted to copy and distribute verbatim copies of this
license document, but changing it is not allowed.


Developer's Certificate of Origin 1.1

By making a contribution to this project, I certify that:

(a) The contribution was created in whole or in part by me and I
    have the right to submit it under the open source license
    indicated in the file; or

(b) The contribution is based upon previous work that, to the best
    of my knowledge, is covered under an appropriate open source
    license and I have the right under that license to submit that
    work with modifications, whether created in whole or in part
    by me, under the same open source license (unless I am
    permitted to submit under a different license), as indicated
    in the file; or

(c) The contribution was provided directly to me by some other
    person who certified (a), (b) or (c) and I have not modified
    it.

(d) I understand and agree that this project and the contribution
    are public and that a record of the contribution (including all
    personal information I submit with it, including my sign-off) is
    maintained indefinitely and may be redistributed consistent with
    this project or the open source license(s) involved.
```

A CI check verifies the sign-off on every commit of a pull request. If you forgot it, fix the
last commit with `git commit --amend -s`, or all commits of the branch with
`git rebase --signoff main`, then force-push your branch.

## Third-party code

Prefer depending on a package over copying code. If you copy or adapt code from another
project, it must be under a compatible license (MIT, Apache-2.0, BSD, ISC), keep its copyright
notice, and get an entry in [THIRD_PARTY_NOTICES.md](THIRD_PARTY_NOTICES.md).
