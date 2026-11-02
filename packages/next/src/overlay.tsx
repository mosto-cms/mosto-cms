'use client';

/**
 * The click-to-edit overlay for the site's root layout:
 *
 *   // app/layout.tsx
 *   import { MostoOverlay } from '@mosto-cms/next/overlay';
 *   …<body>{children}<MostoOverlay /></body>
 *
 * It renders nothing and does nothing for visitors: it only wakes up inside
 * the `/admin` iframe (`?mostoEdit=1`). Add `allowedOrigins` only to let
 * another admin (for example a connected platform) drive it.
 */
import { useEffect } from 'react';

import { initMostoOverlay, type OverlayOptions } from '@mosto-cms/overlay';

export function MostoOverlay(props: { allowedOrigins?: string[]; accent?: string }) {
  const origins = (props.allowedOrigins ?? []).join(',');
  useEffect(() => {
    const options: OverlayOptions = {};
    if (origins) options.allowedOrigins = origins.split(',');
    if (props.accent) options.accent = props.accent;
    return initMostoOverlay(options);
  }, [origins, props.accent]);
  return null;
}
