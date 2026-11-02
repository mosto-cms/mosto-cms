/**
 * Client-side image compression before upload. Photos straight from a phone
 * are often 4-12 MB; the site only needs a web-sized copy. Videos are not
 * re-encoded in the browser: they only get the size check.
 */

/** Longest side of a compressed image, in pixels. */
export const MAX_DIMENSION = 2400;
/** Below this size an image within MAX_DIMENSION is uploaded untouched. */
export const COMPRESS_ABOVE_BYTES = 1.5 * 1024 * 1024;

const COMPRESSIBLE = new Set(['image/jpeg', 'image/png', 'image/webp']);

export function fitWithin(width: number, height: number, max = MAX_DIMENSION): { width: number; height: number } {
  if (width <= max && height <= max) return { width, height };
  const scale = max / Math.max(width, height);
  return { width: Math.max(1, Math.round(width * scale)), height: Math.max(1, Math.round(height * scale)) };
}

/** What to do with a file before upload. */
export function compressionPlan(
  file: { type: string; size: number },
  dims: { width: number; height: number } | null,
  accept: string[],
): { compress: false } | { compress: true; type: string; quality: number } {
  if (!COMPRESSIBLE.has(file.type) || !dims) return { compress: false };
  const big = dims.width > MAX_DIMENSION || dims.height > MAX_DIMENSION;
  if (!big && file.size <= COMPRESS_ABOVE_BYTES) return { compress: false };
  // WebP keeps transparency and is much smaller; JPEG when the site does not accept WebP.
  if (accept.includes('image/webp')) return { compress: true, type: 'image/webp', quality: 0.82 };
  if (file.type === 'image/png') return big ? { compress: true, type: 'image/png', quality: 1 } : { compress: false };
  return { compress: true, type: 'image/jpeg', quality: 0.85 };
}

function renamed(name: string, type: string): string {
  const ext = type === 'image/webp' ? 'webp' : type === 'image/png' ? 'png' : 'jpg';
  return `${name.replace(/\.[^.]+$/, '') || 'image'}.${ext}`;
}

/** Compress an image in the browser when it helps; returns the original otherwise. */
export async function prepareUpload(file: File, accept: string[]): Promise<File> {
  if (!COMPRESSIBLE.has(file.type) || typeof createImageBitmap !== 'function' || typeof document === 'undefined') return file;
  let bitmap: ImageBitmap;
  try {
    bitmap = await createImageBitmap(file);
  } catch {
    return file;
  }
  const plan = compressionPlan(file, { width: bitmap.width, height: bitmap.height }, accept);
  if (!plan.compress) {
    bitmap.close?.();
    return file;
  }
  const size = fitWithin(bitmap.width, bitmap.height);
  const canvas = document.createElement('canvas');
  canvas.width = size.width;
  canvas.height = size.height;
  const ctx = canvas.getContext('2d');
  if (!ctx) return file;
  ctx.drawImage(bitmap, 0, 0, size.width, size.height);
  bitmap.close?.();
  const blob = await new Promise<Blob | null>((resolve) => canvas.toBlob(resolve, plan.type, plan.quality));
  if (!blob || blob.type !== plan.type || blob.size >= file.size) return file;
  return new File([blob], renamed(file.name, plan.type), { type: plan.type });
}

export function readAsBase64(file: Blob): Promise<string> {
  return new Promise((resolve, reject) => {
    const r = new FileReader();
    r.onload = () => resolve(String(r.result).replace(/^data:[^,]*,/, ''));
    r.onerror = () => reject(r.error);
    r.readAsDataURL(file);
  });
}
