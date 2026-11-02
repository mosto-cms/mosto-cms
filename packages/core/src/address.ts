/**
 * Field addresses: `<collection>:<id>:<path>`.
 *
 * The same string is used in page annotations (`data-mosto-field`), in protocol
 * calls and in messages between the editor and the site, e.g.
 * `content:home:it.hero.title` or `fleet:libeccio:gallery.2`.
 */
import { CmsError } from './errors.js';
import { splitPath } from './paths.js';

export type FieldRef = { collection: string; id: string; path: string };

export function parseFieldRef(address: string): FieldRef {
  if (typeof address !== 'string') {
    throw new CmsError('bad_request', 'field address must be a string');
  }
  const first = address.indexOf(':');
  const second = first < 0 ? -1 : address.indexOf(':', first + 1);
  if (first <= 0 || second <= first + 1 || second === address.length - 1) {
    throw new CmsError(
      'bad_request',
      `invalid field address "${address}" (expected "collection:id:path")`,
    );
  }
  const ref = {
    collection: address.slice(0, first),
    id: address.slice(first + 1, second),
    path: address.slice(second + 1),
  };
  splitPath(ref.path);
  return ref;
}

export function formatFieldRef(ref: FieldRef): string {
  if (ref.collection.includes(':') || ref.id.includes(':')) {
    throw new CmsError('bad_request', 'collection and id must not contain ":"');
  }
  return `${ref.collection}:${ref.id}:${ref.path}`;
}
