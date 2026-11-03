/**
 * The visual editor messages of `mosto-cms/1` (spec §5), shared by the site
 * overlay and the admin. Every message carries `type` and `v`.
 */
import { isFieldKind, type SelectedField } from './field.js';

export const MESSAGE_VERSION = 1 as const;

export type Rect = { top: number; left: number; width: number; height: number };

/** `edit`: click-to-edit (links do not navigate). `browse`: the site behaves normally. */
export type EditorMode = 'edit' | 'browse';

export type OverlayLoadedMessage = { type: 'mosto:overlay-loaded'; v: number };
/**
 * `labels`: optional names of fields shown on hover, keyed by
 * `collection:path` (schema paths, list items fall back to their list).
 */
export type InitMessage = { type: 'mosto:init'; v: number; locale?: string; mode?: EditorMode; labels?: Record<string, string> };
export type ReadyMessage = { type: 'mosto:ready'; v: number; fields: number; url?: string };
/** `inline`: the text is being edited in place on the page, so the admin must not take the focus. */
export type SelectMessage = { type: 'mosto:select'; v: number; field: SelectedField; value: string; rect: Rect; inline?: boolean };
export type SetMessage = { type: 'mosto:set'; v: number; field: SelectedField; value: string | string[] };
export type HighlightMessage = { type: 'mosto:highlight'; v: number; field: SelectedField | null };
/** admin → site: switch mode. site → admin: the editor asked to switch (shortcut pressed on the page). */
export type ModeMessage = { type: 'mosto:mode'; v: number; mode: EditorMode };
/** site → admin: a text was edited in place on the page (Enter or blur). */
export type EditMessage = { type: 'mosto:edit'; v: number; field: SelectedField; value: string };
/** site → admin: the selection was cleared on the page (Esc). */
export type DeselectMessage = { type: 'mosto:deselect'; v: number };

/** site → admin */
export type SiteMessage = OverlayLoadedMessage | ReadyMessage | SelectMessage | ModeMessage | EditMessage | DeselectMessage;
/** admin → site */
export type AdminMessage = InitMessage | SetMessage | HighlightMessage | ModeMessage;

const TYPES = new Set([
  'mosto:overlay-loaded',
  'mosto:init',
  'mosto:ready',
  'mosto:select',
  'mosto:set',
  'mosto:highlight',
  'mosto:mode',
  'mosto:edit',
  'mosto:deselect',
]);

export function isEditorMode(v: unknown): v is EditorMode {
  return v === 'edit' || v === 'browse';
}

function isLabels(v: unknown): v is Record<string, string> {
  return !!v && typeof v === 'object' && !Array.isArray(v) && Object.values(v).every((x) => typeof x === 'string');
}

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
      return isField(m.field) && typeof m.value === 'string' && (m.inline === undefined || typeof m.inline === 'boolean') ? (m as SelectMessage) : null;
    case 'mosto:set':
      return isField(m.field) && (typeof m.value === 'string' || (Array.isArray(m.value) && m.value.every((x) => typeof x === 'string')))
        ? (m as SetMessage)
        : null;
    case 'mosto:highlight':
      return m.field === null || isField(m.field) ? (m as HighlightMessage) : null;
    case 'mosto:ready':
      return typeof m.fields === 'number' ? (m as ReadyMessage) : null;
    case 'mosto:init':
      return (m.locale === undefined || typeof m.locale === 'string') &&
        (m.mode === undefined || isEditorMode(m.mode)) &&
        (m.labels === undefined || isLabels(m.labels))
        ? (m as InitMessage)
        : null;
    case 'mosto:mode':
      return isEditorMode(m.mode) ? (m as ModeMessage) : null;
    case 'mosto:edit':
      return isField(m.field) && typeof m.value === 'string' ? (m as EditMessage) : null;
    case 'mosto:deselect':
      return m as DeselectMessage;
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
