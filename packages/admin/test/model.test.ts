import { describe, expect, it } from 'vitest';

import type { FieldDef } from '@mosto-cms/core';

import { compressionPlan, fitWithin } from '../src/compress.js';
import { pickLanguage, relativeTime, translator, MESSAGES } from '../src/i18n.js';
import {
  buildChanges,
  checkValue,
  fieldDef,
  formatBytes,
  formRows,
  labelFor,
  prettyPath,
  publishMessage,
  siblingPaths,
  splitLocale,
  storedValue,
  withDraft,
  type CollectionInfo,
  type Draft,
  type Drafts,
} from '../src/model.js';

const f = (path: string, kind: FieldDef['kind'], label: FieldDef['label'] = path, extra: Partial<FieldDef> = {}): FieldDef => ({ path, kind, label, ...extra });

const home: CollectionInfo = {
  key: 'home',
  type: 'single',
  label: { en: 'Home page', it: 'Pagina iniziale' },
  idField: 'id',
  file: 'content/home.json',
  fields: [
    f('en.hero.title', 'text', { en: 'Headline', it: 'Titolo' }, { required: true, maxLength: 10 }),
    f('it.hero.title', 'text', { en: 'Headline', it: 'Titolo' }),
    f('hero.image', 'image', 'Hero photo'),
    f('gallery', 'imageList', 'Gallery', { maxItems: 3 }),
    f('en.tags', 'list', 'Tags'),
  ],
};
const locales = ['en', 'it'];
const draft = (path: string, value: Draft['value'], before: Draft['before'], kind: Draft['kind'] = 'text'): Draft => ({ collection: 'home', id: 'home', path, kind, value, before });

describe('locales and labels', () => {
  it('splits locale paths and finds the same field in other languages', () => {
    expect(splitLocale('it.hero.title', locales)).toEqual({ locale: 'it', rest: 'hero.title' });
    expect(splitLocale('hero.image', locales)).toEqual({ locale: null, rest: 'hero.image' });
    expect(splitLocale('en', locales)).toEqual({ locale: null, rest: 'en' });
    expect(siblingPaths(home, 'en.hero.title', locales)).toEqual([
      { locale: 'en', path: 'en.hero.title' },
      { locale: 'it', path: 'it.hero.title' },
    ]);
    expect(siblingPaths(home, 'en.tags', locales)).toEqual([{ locale: 'en', path: 'en.tags' }]);
    expect(siblingPaths(home, 'hero.image', locales)).toEqual([]);
  });

  it('groups the forms rows, locales side by side, in schema order', () => {
    const rows = formRows(home, locales);
    expect(rows.map((r) => r.key)).toEqual(['*.hero.title', 'hero.image', 'gallery', '*.tags']);
    const first = rows[0]!;
    expect(first.type === 'localized' && Object.keys(first.fields)).toEqual(['en', 'it']);
  });

  it('labels in the editor language, falling back sensibly', () => {
    expect(labelFor({ en: 'Headline', it: 'Titolo' }, 'it')).toBe('Titolo');
    expect(labelFor({ de: 'Titel' }, 'it', ['de'])).toBe('Titel');
    expect(labelFor('Price', 'it')).toBe('Price');
    expect(prettyPath('en.hero.subTitle', locales)).toBe('Hero sub title');
    expect(prettyPath('gallery.2')).toBe('Gallery #3');
  });

  it('resolves list items to their own field definition', () => {
    expect(fieldDef([home], { collection: 'home', path: 'gallery.1' })).toMatchObject({ kind: 'image', item: { parent: 'gallery', index: 1 } });
    expect(fieldDef([home], { collection: 'home', path: 'layout.theme' })).toBeUndefined();
    expect(fieldDef([home], { collection: 'nope', path: 'x' })).toBeUndefined();
  });
});

describe('drafts', () => {
  const entry = { revision: 'r1', fields: { 'en.hero.title': 'Hello', gallery: ['/a.jpg', '/b.jpg'] } };

  it('reads stored values, list items included', () => {
    expect(storedValue(entry, 'en.hero.title')).toBe('Hello');
    expect(storedValue(entry, 'gallery.1')).toBe('/b.jpg');
    expect(storedValue(entry, 'gallery.5')).toBeNull();
    expect(storedValue(undefined, 'x')).toBeNull();
  });

  it('drops a draft edited back to the stored value', () => {
    let d: Drafts = {};
    d = withDraft(d, draft('en.hero.title', 'Hi', 'Hello'));
    expect(Object.keys(d)).toEqual(['home:home:en.hero.title']);
    d = withDraft(d, draft('en.hero.title', 'Hello', 'Hello'));
    expect(d).toEqual({});
  });

  it('builds changes with before values, folding list items into their list', () => {
    let d: Drafts = {};
    d = withDraft(d, draft('en.hero.title', 'Hi', 'Hello'));
    d = withDraft(d, draft('gallery', ['/a.jpg', '/b.jpg', '/c.jpg'], ['/a.jpg', '/b.jpg'], 'imageList'));
    d = withDraft(d, draft('gallery.0', '/new.jpg', '/a.jpg', 'image'));
    d = withDraft(d, draft('hero.image', '/h.jpg', null, 'image'));
    expect(buildChanges(d)).toEqual([
      { collection: 'home', id: 'home', path: 'en.hero.title', value: 'Hi', before: 'Hello' },
      { collection: 'home', id: 'home', path: 'gallery', value: ['/new.jpg', '/b.jpg', '/c.jpg'], before: ['/a.jpg', '/b.jpg'] },
      { collection: 'home', id: 'home', path: 'hero.image', value: '/h.jpg' },
    ]);
  });

  it('keeps a lone list item as a per-index change', () => {
    const d = withDraft({}, draft('gallery.1', '/x.jpg', '/b.jpg', 'image'));
    expect(buildChanges(d)).toEqual([{ collection: 'home', id: 'home', path: 'gallery.1', value: '/x.jpg', before: '/b.jpg' }]);
  });

  it('writes a readable commit message', () => {
    let d: Drafts = {};
    d = withDraft(d, draft('en.hero.title', 'Hi', 'Hello'));
    d = withDraft(d, draft('it.hero.title', 'Ciao', 'Salve'));
    d = withDraft(d, draft('hero.image', '/h.jpg', '/old.jpg', 'image'));
    expect(publishMessage(d, [home], 'en', locales, 'Update')).toBe('Headline (EN), Headline (IT), Hero photo');
    expect(publishMessage(d, [home], 'it', locales, 'Update')).toBe('Titolo (EN), Titolo (IT), Hero photo');
    expect(publishMessage({}, [home], 'en', locales, 'Update')).toBe('Update');
  });

  it('checks values like the server does', () => {
    const title = fieldDef([home], { collection: 'home', path: 'en.hero.title' })!;
    expect(checkValue(title, 'ok')).toBeNull();
    expect(checkValue(title, '  ')).toEqual({ code: 'required' });
    expect(checkValue(title, 'much too long here')).toEqual({ code: 'tooLong', limit: 10 });
    expect(checkValue(title, 'a\nb')).toEqual({ code: 'singleLine' });
    const gallery = fieldDef([home], { collection: 'home', path: 'gallery' })!;
    expect(checkValue(gallery, ['1', '2', '3', '4'])).toEqual({ code: 'tooMany', limit: 3 });
    const image = fieldDef([home], { collection: 'home', path: 'hero.image' })!;
    expect(checkValue(image, 'javascript:alert(1)')).toEqual({ code: 'scheme' });
  });
});

describe('uploads', () => {
  const accept = ['image/jpeg', 'image/png', 'image/webp', 'video/mp4'];
  it('fits big photos inside 2400 px', () => {
    expect(fitWithin(6000, 4000)).toEqual({ width: 2400, height: 1600 });
    expect(fitWithin(800, 600)).toEqual({ width: 800, height: 600 });
  });
  it('compresses only big photos, to WebP when the site accepts it', () => {
    expect(compressionPlan({ type: 'image/jpeg', size: 500_000 }, { width: 1200, height: 800 }, accept)).toEqual({ compress: false });
    expect(compressionPlan({ type: 'image/jpeg', size: 6_000_000 }, { width: 4000, height: 3000 }, accept)).toMatchObject({ compress: true, type: 'image/webp' });
    expect(compressionPlan({ type: 'image/jpeg', size: 6_000_000 }, { width: 2000, height: 1000 }, ['image/jpeg'])).toMatchObject({ compress: true, type: 'image/jpeg' });
    expect(compressionPlan({ type: 'image/gif', size: 6_000_000 }, { width: 4000, height: 3000 }, accept)).toEqual({ compress: false });
    expect(compressionPlan({ type: 'video/mp4', size: 6_000_000 }, null, accept)).toEqual({ compress: false });
  });
  it('formats sizes', () => {
    expect(formatBytes(10 * 1024 * 1024)).toBe('10 MB');
    expect(formatBytes(1536)).toBe('2 KB');
  });
});

describe('i18n', () => {
  it('picks the browser language, a stored choice first, English otherwise', () => {
    expect(pickLanguage(['it-IT', 'en'])).toBe('it');
    expect(pickLanguage(['de-DE', 'fr'])).toBe('en');
    expect(pickLanguage(['it-IT'], 'en')).toBe('en');
    expect(pickLanguage(undefined, 'xx')).toBe('en');
  });
  it('has every message in Italian too', () => {
    expect(Object.keys(MESSAGES.it).sort()).toEqual(Object.keys(MESSAGES.en).sort());
    for (const v of Object.values(MESSAGES.it)) expect(v).not.toBe('');
  });
  it('fills placeholders and says when', () => {
    expect(translator('it')('field.tooLong', { limit: 80 })).toBe('Troppo lungo: massimo 80 caratteri.');
    const now = Date.parse('2026-11-02T12:00:00Z');
    expect(relativeTime('2026-11-02T11:58:00Z', 'en', now)).toBe('2 min ago');
    expect(relativeTime('2026-11-02T09:00:00Z', 'it', now)).toBe('3 ore fa');
    expect(relativeTime('2026-11-01T09:00:00Z', 'en', now)).toBe('yesterday');
  });
});
