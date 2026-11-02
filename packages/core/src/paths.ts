/**
 * Dot-path helpers over plain JSON values ("it.hero.title", "gallery.2").
 */
import { CmsError } from './errors.js';

const FORBIDDEN_SEGMENTS = new Set(['__proto__', 'prototype', 'constructor']);

export function splitPath(path: string): string[] {
  const parts = path.split('.');
  for (const p of parts) {
    if (p === '') {
      throw new CmsError('bad_request', `invalid path "${path}": empty segment`);
    }
    if (FORBIDDEN_SEGMENTS.has(p)) {
      throw new CmsError('bad_request', `invalid path "${path}": forbidden segment "${p}"`);
    }
  }
  return parts;
}

export function isIndexSegment(segment: string): boolean {
  return /^(0|[1-9]\d*)$/.test(segment);
}

export function getByPath(obj: unknown, path: string): unknown {
  let acc: unknown = obj;
  for (const key of splitPath(path)) {
    if (acc == null || typeof acc !== 'object') return undefined;
    if (!Object.prototype.hasOwnProperty.call(acc, key)) return undefined;
    acc = (acc as Record<string, unknown>)[key];
  }
  return acc;
}

/**
 * Set `value` at `path`, creating missing intermediate objects (never arrays).
 * Writing through a non-object, or to an array index that does not exist yet,
 * is refused: the fence edits existing structure, it does not invent it.
 */
export function setByPath(
  obj: Record<string, unknown>,
  path: string,
  value: unknown,
): void {
  const keys = splitPath(path);
  const last = keys.pop() as string;
  let target: Record<string, unknown> | unknown[] = obj;
  for (const key of keys) {
    const container = target as Record<string, unknown>;
    let next = Object.prototype.hasOwnProperty.call(container, key)
      ? container[key]
      : undefined;
    if (next == null) {
      if (Array.isArray(target) || isIndexSegment(key)) {
        throw new CmsError('invalid_value', `path "${path}": "${key}" does not exist`);
      }
      next = {};
      container[key] = next;
    }
    if (typeof next !== 'object') {
      throw new CmsError(
        'invalid_value',
        `path "${path}": segment "${key}" is not an object`,
      );
    }
    target = next as Record<string, unknown> | unknown[];
  }
  if (Array.isArray(target)) {
    if (!isIndexSegment(last) || Number(last) >= target.length) {
      throw new CmsError(
        'invalid_value',
        `path "${path}": index "${last}" is out of range (length ${target.length})`,
      );
    }
    target[Number(last)] = value;
    return;
  }
  (target as Record<string, unknown>)[last] = value;
}

/** Structural equality for JSON values (strings, numbers, arrays, objects). */
export function jsonEqual(a: unknown, b: unknown): boolean {
  if (a === b) return true;
  if (typeof a !== typeof b || a === null || b === null) return false;
  if (Array.isArray(a)) {
    if (!Array.isArray(b) || a.length !== b.length) return false;
    return a.every((v, i) => jsonEqual(v, b[i]));
  }
  if (typeof a === 'object') {
    if (Array.isArray(b)) return false;
    const ka = Object.keys(a as object);
    const kb = Object.keys(b as object);
    if (ka.length !== kb.length) return false;
    return ka.every((k) =>
      jsonEqual((a as Record<string, unknown>)[k], (b as Record<string, unknown>)[k]),
    );
  }
  return false;
}
