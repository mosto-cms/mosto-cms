# @mosto-cms/adapter-fs

Local file storage for [Mosto CMS](https://github.com/mosto-cms/mosto-cms), for development:
the dev server edits the JSON files of your working copy and you commit them with git.
Writes are checked against the revision they were read at and are applied all-or-nothing.
No history (use git). Node.js 20+. MIT licensed.

```ts
import { createFsAdapter } from '@mosto-cms/adapter-fs';

const adapter = createFsAdapter({ root: process.cwd() });
```
