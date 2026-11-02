import { describe, expect, it } from 'vitest';

import { createCms, createMemoryAdapter, handleRequest, type ContentAdapter } from '../src/index.js';
import { files } from './fixtures/site.js';
import { expectCode, setup, siteSchema } from './helpers.js';

describe('describe / list / get', () => {
  it('describes the site and the caller', () => {
    const { cms } = setup({ access: { write: false, collections: ['fleet'] } });
    const d = cms.describe();
    expect(d.protocol).toBe('mosto-cms/1');
    expect(d.collections.map((c) => c.key)).toEqual(['fleet']);
    expect(d.access).toEqual({ write: false, collections: ['fleet'], actor: 'human' });
    expect(d.capabilities).toEqual({ history: true, revert: true, uploadAsset: false });
  });

  it('lists editable fields and entries', async () => {
    const { cms } = setup();
    expect(cms.listEditableFields().map((c) => c.key)).toEqual(['content', 'fleet', 'tours']);
    expect(await cms.listEntries({ collection: 'fleet' })).toEqual([
      { id: 'libeccio', title: 'Libeccio' },
      { id: 'gabbiano', title: 'Gabbiano' },
    ]);
    expect(await cms.listEntries({ collection: 'content' })).toEqual([{ id: 'home', title: 'home' }]);
  });

  it('reads one field, or only the declared fields of an entry', async () => {
    const { cms } = setup();
    const one = await cms.getField({ collection: 'fleet', id: 'libeccio', path: 'gallery.1' });
    expect(one).toMatchObject({ kind: 'image', value: '/fleet/libeccio/2.jpg' });
    const all = await cms.getField({ collection: 'content', id: 'home' });
    expect('fields' in all && Object.keys(all.fields)).toEqual([
      'it.hero.title',
      'en.hero.title',
      'it.hero.subtitle',
      'hero.video',
    ]);
    expect(JSON.stringify(all)).not.toContain('analyticsId');
  });

  it('returns not_found for unknown collections and entries', async () => {
    const { cms } = setup();
    await expectCode(cms.listEntries({ collection: 'nope' }), 'not_found');
    await expectCode(cms.getField({ collection: 'fleet', id: 'nope', path: 'cover' }), 'not_found');
  });
});

describe('the fence', () => {
  it('refuses reads and writes of undeclared paths with field_not_editable', async () => {
    const { cms, adapter } = setup();
    const before = adapter.files();
    await expectCode(cms.getField({ collection: 'content', id: 'home', path: 'internal.analyticsId' }), 'field_not_editable');
    await expectCode(
      cms.previewChange({ changes: [{ collection: 'fleet', id: 'libeccio', path: 'specs.length', value: '99 m' }] }),
      'field_not_editable',
    );
    const err = await expectCode(
      cms.publish({
        changes: [
          { collection: 'fleet', id: 'libeccio', path: 'it.tagline', value: 'ok' },
          { collection: 'fleet', id: 'libeccio', path: 'slug', value: 'hijacked' },
        ],
      }),
      'field_not_editable',
    );
    expect(err.details).toEqual({ collection: 'fleet', path: 'slug' });
    expect(adapter.files()).toEqual(before);
  });

  it('allows one item of a declared list, never a list item of a scalar', async () => {
    const { cms } = setup();
    const r = await cms.publish({
      changes: [{ collection: 'fleet', id: 'libeccio', path: 'gallery.2', value: '/uploads/new.jpg' }],
    });
    expect(r.published).toBe(true);
    const g = await cms.getField({ collection: 'fleet', id: 'libeccio', path: 'gallery' });
    expect(g).toMatchObject({ value: ['/fleet/libeccio/1.jpg', '/fleet/libeccio/2.jpg', '/uploads/new.jpg'] });
    await expectCode(
      cms.previewChange({ changes: [{ collection: 'fleet', id: 'libeccio', path: 'cover.0', value: 'x' }] }),
      'field_not_editable',
    );
    await expectCode(
      cms.previewChange({ changes: [{ collection: 'fleet', id: 'libeccio', path: 'gallery.9', value: '/x.jpg' }] }),
      'invalid_value',
    );
  });

  it('applies key scope and read-only keys', async () => {
    const ro = setup({ access: { write: false } }).cms;
    await expectCode(
      ro.publish({ changes: [{ collection: 'tours', id: 'giro-isola', path: 'price', value: '€ 1' }] }),
      'forbidden',
    );
    await expectCode(ro.uploadAsset({ filename: 'a.png', contentType: 'image/png', dataBase64: 'AAAA' }), 'forbidden');
    const scoped = setup({ access: { collections: ['tours'] } }).cms;
    await expectCode(scoped.listEntries({ collection: 'fleet' }), 'forbidden');
    expect(scoped.listEditableFields().map((c) => c.key)).toEqual(['tours']);
  });

  it('keeps ai.locked fields out of reach of AI callers only', async () => {
    const schema = siteSchema((s) => {
      s.collections[2]!.fields[1]!.ai = { locked: true, instructions: 'Never change prices' };
    });
    const change = { collection: 'tours', id: 'giro-isola', path: 'price', value: '€ 99' };
    const ai = setup({ schema, access: { actor: 'ai' } }).cms;
    const err = await expectCode(ai.publish({ changes: [change] }), 'field_not_editable');
    expect(err.details?.reason).toBe('ai_locked');
    expect((await ai.getField({ collection: 'tours', id: 'giro-isola', path: 'price' })).revision).toBeTruthy();
    const human = setup({ schema }).cms;
    expect((await human.publish({ changes: [change] })).published).toBe(true);
  });
});

describe('invalid_value', () => {
  const { cms } = setup();
  const one = (path: string, value: unknown, collection = 'fleet', id = 'libeccio') =>
    cms.previewChange({ changes: [{ collection, id, path, value: value as string }] });

  it.each([
    ['a list into a text field', 'it.tagline', ['a']],
    ['a string into a list field', 'gallery', 'a.jpg'],
    ['a non-string list item', 'it.highlights', ['ok', 3]],
    ['a javascript: URL into an image', 'cover', 'javascript:alert(1)'],
    ['a newline into a single-line text', 'it.tagline', 'two\nlines'],
    ['control characters', 'it.tagline', 'bad\u0007bell'],
  ])('refuses %s', async (_label, path, value) => {
    await expectCode(one(path, value), 'invalid_value');
  });

  it('enforces required, maxLength and maxItems', async () => {
    const schema = siteSchema((s) => {
      const f = s.collections[1]!.fields;
      f[0] = { ...f[0]!, required: true, maxLength: 10 };
      f[3] = { ...f[3]!, maxItems: 2 };
    });
    const c = setup({ schema }).cms;
    const ch = (path: string, value: string | string[]) =>
      c.previewChange({ changes: [{ collection: 'fleet', id: 'libeccio', path, value }] });
    await expectCode(ch('it.tagline', '   '), 'invalid_value');
    await expectCode(ch('it.tagline', 'più di dieci caratteri'), 'invalid_value');
    expect((await ch('it.tagline', 'àèìòù€€€€€')).changes[0]!.changed).toBe(true);
    await expectCode(ch('it.highlights', ['a', 'b', 'c']), 'invalid_value');
  });

  it('accepts multiline text in multiline fields', async () => {
    const r = await one('it.hero.subtitle', 'riga uno\nriga due', 'content', 'home');
    expect(r.changes[0]).toMatchObject({ kind: 'multiline', changed: true });
  });
});

describe('publish', () => {
  it('previews without writing, then commits every file in one revision', async () => {
    const { cms, adapter } = setup();
    const changes = [
      { collection: 'content', id: 'home', path: 'it.hero.title', value: 'Ciao Capri' },
      { collection: 'tours', id: 'capri-positano', path: 'price', value: '€ 260' },
    ];
    const before = adapter.files();
    const preview = await cms.previewChange({ changes });
    expect(preview.changes.map((c) => [c.before, c.after])).toEqual([
      ['Benvenuti a Capri', 'Ciao Capri'],
      ['€ 250', '€ 260'],
    ]);
    expect(Object.keys(preview.revisions)).toEqual(['app/data/content.json', 'app/data/tours.json']);
    expect(adapter.files()).toEqual(before);

    const r = await cms.publish({ message: 'Update home and prices', changes, baseRevisions: preview.revisions });
    expect(r).toMatchObject({ published: true, files: ['app/data/content.json', 'app/data/tours.json'] });
    const h = await cms.history();
    expect(h.entries[0]).toMatchObject({ revision: r.revision, message: 'Update home and prices' });
    expect(h.entries[0]!.files).toEqual(['app/data/content.json', 'app/data/tours.json']);
  });

  it('keeps file layout and untouched content intact', async () => {
    const { cms, adapter } = setup();
    await cms.publish({ changes: [{ collection: 'fleet', id: 'gabbiano', path: 'it.tagline', value: 'Nuovo' }] });
    const after = adapter.files()['app/data/fleet.json']!;
    expect(after).toBe(files['app/data/fleet.json']!.replace('"Classico"', '"Nuovo"'));
    expect(adapter.files()['app/data/content.json']).toBe(files['app/data/content.json']);
  });

  it('does not commit when nothing changes', async () => {
    const { cms } = setup();
    const r = await cms.publish({ changes: [{ collection: 'tours', id: 'giro-isola', path: 'price', value: '€ 120' }] });
    expect(r).toMatchObject({ published: false, revision: null, files: [] });
    expect((await cms.history()).entries).toHaveLength(1);
  });

  it('refuses duplicate changes to the same field', async () => {
    const { cms } = setup();
    const c = { collection: 'tours', id: 'giro-isola', path: 'price', value: '€ 1' };
    await expectCode(cms.publish({ changes: [c, { ...c, value: '€ 2' }] }), 'bad_request');
  });
});

describe('conflicts', () => {
  it('refuses when the field changed since the caller read it', async () => {
    const { cms, adapter } = setup();
    const read = await cms.getField({ collection: 'tours', id: 'giro-isola', path: 'price' });
    adapter.seed({ 'app/data/tours.json': files['app/data/tours.json']!.replace('€ 120', '€ 130') }, 'someone else');
    const err = await expectCode(
      cms.publish({
        changes: [{ collection: 'tours', id: 'giro-isola', path: 'price', value: '€ 125', before: 'value' in read ? read.value! : '' }],
      }),
      'conflict',
    );
    expect(err.details).toMatchObject({ expected: '€ 120', current: '€ 130' });
  });

  it('strict mode refuses any change to the file since the preview', async () => {
    const { cms, adapter } = setup();
    const changes = [{ collection: 'tours', id: 'giro-isola', path: 'price', value: '€ 125' }];
    const p = await cms.previewChange({ changes });
    adapter.seed({ 'app/data/tours.json': files['app/data/tours.json']!.replace('Capri e Positano', 'Capri & Positano') });
    await expectCode(cms.publish({ changes, baseRevisions: p.revisions }), 'conflict');
  });

  it('retries once on a concurrent commit to another field, never overwriting it', async () => {
    const mem = createMemoryAdapter(files);
    let raced = false;
    const racing: ContentAdapter = {
      name: 'racing',
      readFile: (p, o) => mem.readFile(p, o),
      commit: async (input) => {
        if (!raced) {
          raced = true;
          mem.seed({ 'app/data/tours.json': files['app/data/tours.json']!.replace('€ 250', '€ 999') }, 'concurrent');
        }
        return mem.commit(input);
      },
    };
    const cms = createCms({ schema: siteSchema(), adapter: racing });
    const r = await cms.publish({ changes: [{ collection: 'tours', id: 'giro-isola', path: 'price', value: '€ 125' }] });
    expect(r.published).toBe(true);
    const tours = JSON.parse(mem.files()['app/data/tours.json']!) as Array<{ price: string }>;
    expect(tours.map((t) => t.price)).toEqual(['€ 125', '€ 999']);
  });

  it('a stale base revision in the adapter is a conflict', async () => {
    const mem = createMemoryAdapter(files);
    await expectCode(
      mem.commit({ message: 'x', files: [{ path: 'app/data/tours.json', content: { encoding: 'utf8', data: '[]' }, baseRevision: 'stale' }] }),
      'conflict',
    );
    await expectCode(
      mem.commit({ message: 'x', files: [{ path: 'app/data/tours.json', content: { encoding: 'utf8', data: '[]' }, baseRevision: null }] }),
      'conflict',
    );
  });
});

describe('uploadAsset', () => {
  it('commits a new file under the media dir and returns its public path', async () => {
    const { cms, adapter } = setup();
    const r = await cms.uploadAsset({
      filename: 'Barca al Tramonto.JPG',
      contentType: 'image/jpeg',
      dataBase64: 'data:image/jpeg;base64,/9j/4AAQSkZJRg==',
      field: { collection: 'fleet', path: 'gallery' },
    });
    expect(r).toMatchObject({ path: '/uploads/barca-al-tramonto-abcd1234.jpg', file: 'public/uploads/barca-al-tramonto-abcd1234.jpg', bytes: 10 });
    expect(adapter.files()[r.file]).toBe('base64:/9j/4AAQSkZJRg==');
  });

  it('refuses unsupported types, oversize files and non-media fields', async () => {
    const schema = siteSchema((s) => {
      s.media = { dir: 'public/media', publicPath: '/media', maxBytes: 4 };
    });
    const { cms } = setup({ schema });
    await expectCode(cms.uploadAsset({ filename: 'x.exe', contentType: 'application/x-msdownload', dataBase64: 'AAAA' }), 'unsupported');
    await expectCode(cms.uploadAsset({ filename: 'x.png', contentType: 'image/png', dataBase64: 'AAAAAAAA' }), 'too_large');
    await expectCode(
      cms.uploadAsset({ filename: 'x.png', contentType: 'image/png', dataBase64: 'AAAA', field: { collection: 'tours', path: 'price' } }),
      'invalid_value',
    );
    await expectCode(cms.uploadAsset({ filename: 'x.png', contentType: 'image/png', dataBase64: '###' }), 'bad_request');
    const ok = await cms.uploadAsset({ filename: 'x.png', contentType: 'image/png', dataBase64: 'AAAA' });
    expect(ok.path).toBe('/media/x-abcd1234.png');
  });
});

describe('history and revert', () => {
  it('reverts the fields a revision changed, and only those', async () => {
    const { cms, adapter } = setup();
    const first = await cms.publish({
      message: 'Spring prices',
      changes: [
        { collection: 'tours', id: 'giro-isola', path: 'price', value: '€ 140' },
        { collection: 'fleet', id: 'libeccio', path: 'it.tagline', value: 'Primavera' },
      ],
    });
    await cms.publish({ changes: [{ collection: 'tours', id: 'capri-positano', path: 'price', value: '€ 270' }] });
    const r = await cms.revert({ revision: first.revision! });
    expect(r).toMatchObject({ published: true, reverted: first.revision });
    const tours = JSON.parse(adapter.files()['app/data/tours.json']!) as Array<{ price: string }>;
    expect(tours.map((t) => t.price)).toEqual(['€ 120', '€ 270']);
    const fleet = await cms.getField({ collection: 'fleet', id: 'libeccio', path: 'it.tagline' });
    expect('value' in fleet && fleet.value).toBe('Veloce e comodo');
    expect((await cms.history({ limit: 1 })).entries[0]!.message).toBe('Revert "Spring prices"');
  });

  it('refuses to revert a field changed again afterwards, unless forced', async () => {
    const { cms } = setup();
    const first = await cms.publish({ changes: [{ collection: 'tours', id: 'giro-isola', path: 'price', value: '€ 140' }] });
    await cms.publish({ changes: [{ collection: 'tours', id: 'giro-isola', path: 'price', value: '€ 150' }] });
    await expectCode(cms.revert({ revision: first.revision! }), 'conflict');
    const forced = await cms.revert({ revision: first.revision!, force: true });
    expect(forced.published).toBe(true);
  });

  it('never reverts content outside the fence', async () => {
    const { cms, adapter } = setup();
    const raw = files['app/data/fleet.json']!.replace('"10 m"', '"11 m"');
    const devCommit = adapter.seed({ 'app/data/fleet.json': raw }, 'dev: fix specs');
    await expectCode(cms.revert({ revision: devCommit }), 'bad_request');
    await expectCode(cms.revert({ revision: 'nope' }), 'not_found');
  });

  it('reports unsupported when the adapter has no history', async () => {
    const mem = createMemoryAdapter(files);
    const bare: ContentAdapter = { name: 'bare', readFile: mem.readFile, commit: mem.commit };
    const cms = createCms({ schema: siteSchema(), adapter: bare });
    expect(cms.describe().capabilities.history).toBe(false);
    await expectCode(cms.history(), 'unsupported');
    await expectCode(cms.revert({ revision: 'r1' }), 'unsupported');
  });
});

describe('protocol envelope', () => {
  it('wraps results and errors with stable codes and HTTP statuses', async () => {
    const { cms } = setup();
    const ok = await handleRequest(cms, { op: 'listEntries', input: { collection: 'tours' } });
    expect(ok.status).toBe(200);
    expect(ok.body).toMatchObject({ ok: true, protocol: 'mosto-cms/1' });

    const fence = await handleRequest(cms, {
      op: 'publish',
      input: { changes: [{ collection: 'content', id: 'home', path: 'internal.analyticsId', value: 'x' }] },
    });
    expect(fence).toMatchObject({ status: 403, body: { ok: false, error: { code: 'field_not_editable' } } });

    expect((await handleRequest(cms, { op: 'dropDatabase' })).status).toBe(400);
    expect((await handleRequest(cms, 'nope')).status).toBe(400);
    expect((await handleRequest(cms, { op: 'publish', input: { changes: [] } })).body).toMatchObject({
      error: { code: 'bad_request' },
    });
    expect((await handleRequest(cms, { op: 'getField', input: { collection: 'tours', id: 'x', path: 'price' } })).status).toBe(404);
  });
});
