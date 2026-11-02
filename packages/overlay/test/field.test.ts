import { describe, expect, it } from 'vitest';

import { fieldAddress, mostoField, normalizeOrigin, parseFieldAddress, readMessage } from '../src/index.js';

describe('mostoField', () => {
  it('builds the address from an entry object or "collection:id"', () => {
    expect(mostoField('home:home', 'en.hero.title')).toEqual({ 'data-mosto-field': 'home:home:en.hero.title' });
    expect(mostoField({ collection: 'fleet', id: 'libeccio' }, 'cover', undefined, { kind: 'image' })).toEqual({
      'data-mosto-field': 'fleet:libeccio:cover',
      'data-mosto-kind': 'image',
    });
  });

  it('addresses one item of a list field', () => {
    expect(mostoField('fleet:libeccio', 'gallery', 2)['data-mosto-field']).toBe('fleet:libeccio:gallery.2');
    expect(mostoField('fleet:libeccio', 'gallery', 0)['data-mosto-field']).toBe('fleet:libeccio:gallery.0');
    expect(mostoField('fleet:libeccio', 'gallery', null)['data-mosto-field']).toBe('fleet:libeccio:gallery');
  });

  it('refuses malformed input instead of writing a broken annotation', () => {
    expect(() => mostoField('fleet', 'cover')).toThrow(TypeError);
    expect(() => mostoField('a:b:c', 'cover')).toThrow(TypeError);
    expect(() => mostoField({ collection: 'a:x', id: 'b' }, 'cover')).toThrow(TypeError);
    expect(() => mostoField('a:b', '')).toThrow(TypeError);
    expect(() => mostoField('a:b', 'x..y')).toThrow(TypeError);
    expect(() => mostoField('a:b', '__proto__.x')).toThrow(TypeError);
    expect(() => mostoField('a:b', 'gallery', -1)).toThrow(TypeError);
    expect(() => mostoField('a:b', 'gallery', 1.5)).toThrow(TypeError);
    // @ts-expect-error unknown kind
    expect(() => mostoField('a:b', 'x', null, { kind: 'html' })).toThrow(TypeError);
  });

  it('round-trips addresses', () => {
    const ref = { collection: 'content', id: 'home', path: 'it.hero.title' };
    expect(parseFieldAddress(fieldAddress(ref))).toEqual(ref);
    expect(parseFieldAddress('content:home:a:b')).toEqual({ collection: 'content', id: 'home', path: 'a:b' });
    for (const bad of ['', 'a', 'a:b', ':b:c', 'a::c', 'a:b:', 'a:b:x..y', 'a:b:constructor', null]) {
      expect(parseFieldAddress(bad)).toBeNull();
    }
  });
});

describe('messages', () => {
  const field = { collection: 'home', id: 'home', path: 'en.hero.title', kind: 'text' };

  it('accepts well-formed messages of version 1', () => {
    expect(readMessage({ type: 'mosto:init', v: 1, locale: 'en' })).toMatchObject({ type: 'mosto:init' });
    expect(readMessage({ type: 'mosto:select', v: 1, field, value: 'x', rect: {} })).toMatchObject({ type: 'mosto:select' });
    expect(readMessage({ type: 'mosto:set', v: 1, field, value: ['a', 'b'] })).toMatchObject({ type: 'mosto:set' });
    expect(readMessage({ type: 'mosto:highlight', v: 1, field: null })).toMatchObject({ type: 'mosto:highlight' });
  });

  it('ignores unknown, unversioned, newer or malformed messages', () => {
    expect(readMessage(null)).toBeNull();
    expect(readMessage('mosto:init')).toBeNull();
    expect(readMessage({ type: 'mosto:init' })).toBeNull();
    expect(readMessage({ type: 'mosto:init', v: 2 })).toBeNull();
    expect(readMessage({ type: 'mosto:other', v: 1 })).toBeNull();
    expect(readMessage({ type: 'mosto:set', v: 1, field: { ...field, kind: 'html' }, value: 'x' })).toBeNull();
    expect(readMessage({ type: 'mosto:set', v: 1, field, value: 3 })).toBeNull();
    expect(readMessage({ type: 'mosto:select', v: 1, field: { ...field, id: '' }, value: 'x' })).toBeNull();
  });

  it('normalizes origins and refuses non-http ones', () => {
    expect(normalizeOrigin('https://studio.example/x?y')).toBe('https://studio.example');
    expect(normalizeOrigin('javascript:alert(1)')).toBeNull();
    expect(normalizeOrigin('not a url')).toBeNull();
  });
});
