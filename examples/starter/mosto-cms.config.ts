/**
 * Mosto CMS wiring for this site.
 *
 * - Without MOSTO_CMS_GITHUB_REPO (local development), content is read and
 *   written on disk: publishing from /admin edits the JSON files in content/.
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
  adapter: (env) => githubAdapterFromEnv(env) ?? createFsAdapter({ root: contentRoot() }),
});

export const content = createContentReader({
  schema,
  source: () => githubSourceFromEnv(process.env) ?? fsSource({ root: contentRoot() }),
  bundled: { 'content/home.json': home, 'content/products.json': products },
});
