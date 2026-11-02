import { describe, expect, it } from 'vitest';

import { formatFieldRef, getByPath, jsonEqual, parseFieldRef, setByPath } from '../src/index.js';
import { expectCode } from './helpers.js';

describe('field addresses', () => {
  it('parses collection:id:path', () => {
    expect(parseFieldRef('content:home:it.hero.title')).toEqual({
      collection: 'content',
      id: 'home',
      path: 'it.hero.title',
    });
    expect(parseFieldRef('fleet:libeccio:gallery.2')).toEqual({
      collection: 'fleet',
      id: 'libeccio',
      path: 'gallery.2',
    });
  });

  it('round-trips through formatFieldRef', () => {
    const a = 'tours:giro-isola:it.name';
    expect(formatFieldRef(parseFieldRef(a))).toBe(a);
  });

  it.each(['', 'content', 'content:home', 'content:home:', ':home:path', 'content::path', 'c:i:a..b', 'c:i:__proto__.x'])(
    'rejects %j',
    async (bad) => {
      await expectCode(() => parseFieldRef(bad), 'bad_request');
    },
  );
});

describe('dot paths', () => {
  it('reads nested values and list items', () => {
    const o = { it: { hero: { title: 'x' } }, gallery: ['a', 'b'] };
    expect(getByPath(o, 'it.hero.title')).toBe('x');
    expect(getByPath(o, 'gallery.1')).toBe('b');
    expect(getByPath(o, 'it.missing.deep')).toBeUndefined();
  });

  it('writes nested values, creating missing objects', () => {
    const o: Record<string, unknown> = { it: {} };
    setByPath(o, 'it.hero.title', 'y');
    expect(o).toEqual({ it: { hero: { title: 'y' } } });
  });

  it('writes an existing list item but never extends a list', async () => {
    const o: Record<string, unknown> = { gallery: ['a', 'b'] };
    setByPath(o, 'gallery.1', 'B');
    expect(o.gallery).toEqual(['a', 'B']);
    await expectCode(() => setByPath(o, 'gallery.2', 'c'), 'invalid_value');
  });

  it('refuses prototype pollution', async () => {
    const o: Record<string, unknown> = {};
    await expectCode(() => setByPath(o, '__proto__.polluted', true), 'bad_request');
    await expectCode(() => setByPath(o, 'a.constructor.prototype', true), 'bad_request');
    expect(({} as Record<string, unknown>).polluted).toBeUndefined();
  });

  it('compares JSON values structurally', () => {
    expect(jsonEqual(['a', 'b'], ['a', 'b'])).toBe(true);
    expect(jsonEqual(['a'], 'a')).toBe(false);
    expect(jsonEqual({ a: 1 }, { a: 1 })).toBe(true);
  });
});
