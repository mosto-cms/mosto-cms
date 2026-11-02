/**
 * The visual editor messages of `mosto-cms/1` (spec §5), shared by the site
 * overlay and the admin. Every message carries `type` and `v`.
 */
import { isFieldKind, type SelectedField } from './field.js';

export const MESSAGE_VERSION = 1 as const;

export type Rect = { top: number; left: number; width: number; height: number };

export type OverlayLoadedMessage = { type: 'mosto:overlay-loaded'; v: number };
export type InitMessage = { type: 'mosto:init'; v: number; locale?: string };
export type ReadyMessage = { type: 'mosto:ready'; v: number; fields: number; url?: string };
export type SelectMessage = { type: 'mosto:select'; v: number; field: SelectedField; value: string; rect: Rect };
export type SetMessage = { type: 'mosto:set'; v: number; field: SelectedField; value: string | string[] };
export type HighlightMessage = { type: 'mosto:highlight'; v: number; field: SelectedField | null };

/** site → admin */
export type SiteMessage = OverlayLoadedMessage | ReadyMessage | SelectMessage;
/** admin → site */
export type AdminMessage = InitMessage | SetMessage | HighlightMessage;

const TYPES = new Set(['mosto:overlay-loaded', 'mosto:init', 'mosto:ready', 'mosto:select', 'mosto:set', 'mosto:highlight']);

function isField(v: unknown): v is SelectedField {
  if (!v || typeof v !== 'object') return false;
  const f = v as Record<string, unknown>;
  return (
    typeof f.collection === 'string' &&
    typeof f.id === 'string' &&
    typeof f.path === 'string' &&
    f.collection !== '' &&
    f.id !== '' &&
    f.path !== '' &&
    isFieldKind(f.kind)
  );
}

/**
 * A well-formed message this side understands: known `type`, numeric `v` not
 * above ours (a higher version is ignored, spec §6), and a valid payload.
 */
export function readMessage(data: unknown): SiteMessage | AdminMessage | null {
  if (!data || typeof data !== 'object') return null;
  const m = data as Record<string, unknown>;
  if (typeof m.type !== 'string' || !TYPES.has(m.type)) return null;
  if (typeof m.v !== 'number' || m.v > MESSAGE_VERSION || m.v < 1) return null;
  switch (m.type) {
    case 'mosto:select':
      return isField(m.field) && typeof m.value === 'string' ? (m as SelectMessage) : null;
    case 'mosto:set':
      return isField(m.field) && (typeof m.value === 'string' || (Array.isArray(m.value) && m.value.every((x) => typeof x === 'string')))
        ? (m as SetMessage)
        : null;
    case 'mosto:highlight':
      return m.field === null || isField(m.field) ? (m as HighlightMessage) : null;
    case 'mosto:ready':
      return typeof m.fields === 'number' ? (m as ReadyMessage) : null;
    case 'mosto:init':
      return m.locale === undefined || typeof m.locale === 'string' ? (m as InitMessage) : null;
    default:
      return m as OverlayLoadedMessage;
  }
}

/** `https://a.example/x` → `https://a.example`; null for anything that is not an http(s) origin. */
export function normalizeOrigin(value: string): string | null {
  try {
    const u = new URL(value);
    if (u.protocol !== 'http:' && u.protocol !== 'https:') return null;
    return u.origin;
  } catch {
    return null;
  }
}
