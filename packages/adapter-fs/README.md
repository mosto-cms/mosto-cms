# @mosto-cms/adapter-fs

Local file storage for [Mosto CMS](https://github.com/mosto-cms/mosto-cms), for development:
the dev server edits the JSON files of your working copy and you commit them with git.
Writes are checked against the revision they were read at and are applied all-or-nothing.
Node.js 20+. MIT licensed.

```ts
import { createFsAdapter } from '@mosto-cms/adapter-fs';

const adapter = createFsAdapter({ root: process.cwd() });
// or commit each write with git, which turns on history and undo in /admin:
const withHistory = createFsAdapter({ root: process.cwd(), git: true });
```

With `git: true` the root must be inside a git working copy; each publish commits only the
files it wrote (as the signed-in editor), never the rest of your working copy.
