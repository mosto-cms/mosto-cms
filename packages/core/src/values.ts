/**
 * Value validation for a resolved field (`invalid_value` on failure).
 */
import { CmsError } from './errors.js';
import { LIST_KINDS, type ResolvedField } from './schema.js';

export type FieldValue = string | string[];

const DANGEROUS_SCHEME = /^\s*(javascript|vbscript|data):/i;
// eslint-disable-next-line no-control-regex
const CONTROL_CHARS = /[\u0000-\u0008\u000B\u000C\u000E-\u001F]/;

function charCount(s: string): number {
  return [...s].length;
}

function checkString(field: ResolvedField, value: string, where: string): void {
  if (CONTROL_CHARS.test(value)) {
    throw new CmsError('invalid_value', `${where}: contains control characters`);
  }
  if (field.maxLength != null && charCount(value) > field.maxLength) {
    throw new CmsError(
      'invalid_value',
      `${where}: longer than ${field.maxLength} characters`,
      { maxLength: field.maxLength },
    );
  }
  const media = field.kind === 'image' || field.kind === 'video' || field.kind === 'imageList';
  if ((media || field.kind === 'url') && DANGEROUS_SCHEME.test(value)) {
    throw new CmsError('invalid_value', `${where}: URL scheme not allowed`);
  }
  if ((field.kind === 'text' || field.kind === 'url' || media) && /[\r\n]/.test(value)) {
    throw new CmsError('invalid_value', `${where}: must be a single line`);
  }
}

/** Throws `invalid_value` unless `value` fits the field. */
export function validateValue(
  field: ResolvedField,
  value: unknown,
): asserts value is FieldValue {
  const where = `field "${field.path}" (${field.kind})`;
  if (LIST_KINDS.has(field.kind)) {
    if (!Array.isArray(value) || !value.every((v) => typeof v === 'string')) {
      throw new CmsError('invalid_value', `${where}: expects a list of strings`);
    }
    if (field.required && value.length === 0) {
      throw new CmsError('invalid_value', `${where}: is required`);
    }
    if (field.maxItems != null && value.length > field.maxItems) {
      throw new CmsError('invalid_value', `${where}: more than ${field.maxItems} items`, {
        maxItems: field.maxItems,
      });
    }
    value.forEach((v, i) => checkString(field, v, `${where} item ${i}`));
    return;
  }
  if (typeof value !== 'string') {
    throw new CmsError('invalid_value', `${where}: expects a string`);
  }
  if (field.required && value.trim() === '') {
    throw new CmsError('invalid_value', `${where}: is required`);
  }
  checkString(field, value, where);
}
