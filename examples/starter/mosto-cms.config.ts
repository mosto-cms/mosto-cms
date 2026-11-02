/**
 * Mosto CMS wiring for this site.
 *
 * - Without MOSTO_CMS_GITHUB_REPO (local development), content is read and
 *   written on disk: publishing from /admin edits the JSON files in content/.
 *   Set MOSTO_CMS_FS_GIT=1 to also commit each publish locally, which turns
 *   on History and Undo in /admin.
 * - With it (production), content is committed to the GitHub repo and read
 *   back live through the Next.js data cache.
 */
import { createFsAdapter } from '@mosto-cms/adapter-fs';
import { githubAdapterFromEnv } from '@mosto-cms/adapter-github';
import { createContentReader, defineMostoCms, fsSource, githubSourceFromEnv } from '@mosto-cms/next';

import home from './content/home.json';
import products from './content/products.json';
import schema from './mosto-cms.schema.json';

/** Where content/ lives on disk (the e2e tests point it at a temporary copy). */
const contentRoot = () => process.env.MOSTO_CMS_CONTENT_ROOT || process.cwd();

export const cms = defineMostoCms({
  schema,
  adapter: (env) => githubAdapterFromEnv(env) ?? createFsAdapter({ root: contentRoot(), git: env.MOSTO_CMS_FS_GIT === '1' }),
  admin: {
    pages: [
      { path: '/', label: 'Home (English)' },
      { path: '/it', label: 'Home (Italiano)' },
    ],
  },
});

/** Where the site reads content (and uploads, through app/media) from. */
export const source = () => githubSourceFromEnv(process.env) ?? fsSource({ root: contentRoot() });

export const content = createContentReader({
  schema,
  source,
  bundled: { 'content/home.json': home, 'content/products.json': products },
});
