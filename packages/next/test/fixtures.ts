import { createMemoryAdapter } from '@mosto-cms/core';
import { createConnectorKey, hashPassword, type Editor } from '@mosto-cms/auth';

import { defineMostoCms, type MostoCmsOptions, type RevalidateInfo } from '../src/index.js';

export const SITE = 'https://site.example';
export const secret = 'a-test-site-secret-that-is-long-enough-1234';

export const schema = {
  version: 1,
  locales: ['en', 'it'],
  collections: [
    {
      key: 'home',
      file: 'content/home.json',
      idField: 'id',
      type: 'single',
      label: 'Home',
      fields: [
        { path: 'en.title', kind: 'text', label: 'Title', required: true, maxLength: 40 },
        { path: 'it.title', kind: 'text', label: 'Titolo' },
        { path: 'gallery', kind: 'imageList', label: 'Gallery' },
      ],
    },
    {
      key: 'products',
      file: 'content/products.json',
      idField: 'slug',
      type: 'list',
      label: 'Products',
      fields: [
        { path: 'name', kind: 'text', label: 'Name' },
        { path: 'price', kind: 'text', label: 'Price', ai: { locked: true } },
      ],
    },
  ],
};

export const files = {
  'content/home.json': JSON.stringify({ id: 'home', en: { title: 'Hello' }, it: { title: 'Ciao' }, gallery: ['/a.jpg', '/b.jpg'], layout: 'x' }, null, 2) + '\n',
  'content/products.json': JSON.stringify([{ slug: 'pasta', name: 'Pasta', price: '€ 12' }], null, 2) + '\n',
};

let editorsCache: Editor[] | null = null;
export async function editors(): Promise<Editor[]> {
  editorsCache ??= [{ email: 'anna@example.com', name: 'Anna', passwordHash: await hashPassword('correct horse battery', { logN: 10 }) }];
  return editorsCache;
}

export async function setup(overrides: Partial<MostoCmsOptions> = {}) {
  const adapter = createMemoryAdapter(files);
  const revalidations: RevalidateInfo[] = [];
  const env: Record<string, string | undefined> = {};
  const site = defineMostoCms({
    schema,
    adapter,
    secret,
    editors: await editors(),
    env,
    revalidate: (info) => {
      revalidations.push(info);
    },
    keys: { revocationCacheSeconds: 0 },
    ...overrides,
  });
  const key = (opts: Parameters<typeof createConnectorKey>[0] extends infer T ? Omit<T & object, 'secret'> : never = {}) =>
    createConnectorKey({ secret, ...opts });
  return { site, adapter, revalidations, env, key };
}

export function call(body: unknown, headers: Record<string, string> = {}, path = '/api/mosto-cms'): Request {
  return new Request(`${SITE}${path}`, {
    method: 'POST',
    headers: { 'content-type': 'application/json', ...headers },
    body: typeof body === 'string' ? body : JSON.stringify(body),
  });
}

export const bearer = (key: string) => ({ authorization: `Bearer ${key}` });
