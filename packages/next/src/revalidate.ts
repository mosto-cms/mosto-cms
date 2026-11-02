/**
 * On-demand revalidation after a write, so a publish is visible at the next
 * visit instead of after a rebuild.
 */
import { fileTag } from './source.js';

export type RevalidateInfo = {
  op: 'publish' | 'revert' | 'uploadAsset';
  /** Content files changed by the write. */
  files: string[];
  revision: string | null;
};

export type Revalidator = (info: RevalidateInfo) => void | Promise<void>;

/**
 * Default revalidator for Next.js (15+): immediately expires the cache tag of
 * every changed file (`mosto-cms:file:<path>`, set by `githubSource`) and the
 * rendered pages: the whole route tree by default (`revalidatePath('/',
 * 'layout')`), or only `paths` when given. Uploads only add new files, so
 * there is nothing to expire.
 */
export function nextRevalidator(opts: { paths?: string[] } = {}): Revalidator {
  return async (info) => {
    if (info.files.length === 0) return;
    const mod = (await import('next/cache')) as unknown as {
      revalidateTag: (tag: string, profile: { expire: number }) => void;
      revalidatePath: (path: string, type?: 'layout' | 'page') => void;
    };
    for (const f of info.files) mod.revalidateTag(fileTag(f), { expire: 0 });
    if (opts.paths) for (const p of opts.paths) mod.revalidatePath(p);
    else mod.revalidatePath('/', 'layout');
  };
}
