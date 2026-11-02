'use client';

/**
 * A small carousel: every photo is stacked in the same place and only one is
 * visible. Each frame is annotated per index (`home:home:gallery.<i>`), and
 * the overlay selects the frame actually visible where the editor clicks.
 */
import { useState } from 'react';

import { mostoField } from '@mosto-cms/overlay';

export function Gallery({ photos, label }: { photos: string[]; label: string }) {
  const [current, setCurrent] = useState(0);
  if (photos.length === 0) return null;
  const go = (step: number) => setCurrent((c) => (c + step + photos.length) % photos.length);
  return (
    <section aria-label={label} style={{ position: 'relative', aspectRatio: '3 / 1', margin: '40px 0 0', borderRadius: 12, overflow: 'hidden', background: '#eee8dc' }}>
      {photos.map((src, i) => (
        <img
          key={i}
          {...mostoField('home:home', 'gallery', i, { kind: 'image' })}
          src={src}
          alt=""
          data-testid={`gallery-${i}`}
          style={{ position: 'absolute', inset: 0, width: '100%', height: '100%', objectFit: 'cover', opacity: i === current ? 1 : 0, transition: 'opacity .3s' }}
        />
      ))}
      <button type="button" onClick={() => go(-1)} aria-label="Previous photo" style={arrow('left')}>
        ‹
      </button>
      <button type="button" onClick={() => go(1)} aria-label="Next photo" data-testid="gallery-next" style={arrow('right')}>
        ›
      </button>
    </section>
  );
}

function arrow(side: 'left' | 'right') {
  return { position: 'absolute', top: '50%', [side]: 12, transform: 'translateY(-50%)', width: 40, height: 40, borderRadius: 99, border: 0, background: 'rgba(255,255,255,.85)', fontSize: 22, cursor: 'pointer' } as const;
}
