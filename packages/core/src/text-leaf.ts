/**
 * Onboarding helper: generate the fields of a "site copy" collection by walking
 * every string leaf of a localized entry (e.g. the home entry of content.json).
 * Used once when wiring a site, not at runtime.
 */
import type { FieldDef } from './schema.js';

export type TextLeafOptions = {
  /** Object keys never exposed (structural or enum values), e.g. id, tag, icon. */
  excludeKeys?: string[];
  /** Dot-paths to skip entirely, e.g. legal footer text. */
  excludePathPattern?: RegExp;
  /** Leaf keys rendered as multiline instead of single-line text. */
  multilineKeys?: string[];
  /** Locale roots to walk (default: every key of `locales`, or ["it", "en"]). */
  locales?: string[];
};

function humanizeLabel(path: string): string {
  const [locale, ...rest] = path.split('.');
  const trail = rest.filter((s) => !/^\d+$/.test(s)).join(' › ');
  return `${(locale ?? '').toUpperCase()} · ${trail}`;
}

export function buildTextLeafFields(
  entry: Record<string, unknown>,
  opts: TextLeafOptions = {},
): FieldDef[] {
  const excludeKeys = new Set(opts.excludeKeys ?? []);
  const multilineKeys = new Set(opts.multilineKeys ?? []);
  const locales = opts.locales ?? ['it', 'en'];
  const fields: FieldDef[] = [];

  const walk = (node: unknown, prefix: string, lastKey: string): void => {
    if (typeof node === 'string') {
      if (opts.excludePathPattern?.test(prefix)) return;
      const label = humanizeLabel(prefix);
      fields.push({
        path: prefix,
        kind: multilineKeys.has(lastKey) ? 'multiline' : 'text',
        label: Object.fromEntries(locales.map((l) => [l, label])),
      });
      return;
    }
    if (Array.isArray(node)) {
      node.forEach((v, i) => walk(v, `${prefix}.${i}`, String(i)));
      return;
    }
    if (node && typeof node === 'object') {
      for (const [k, v] of Object.entries(node as Record<string, unknown>)) {
        if (excludeKeys.has(k)) continue;
        walk(v, prefix ? `${prefix}.${k}` : k, k);
      }
    }
  };

  for (const locale of locales) {
    if (entry[locale] != null) walk(entry[locale], locale, '');
  }
  return fields;
}
