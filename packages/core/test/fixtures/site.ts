/**
 * A small synthetic site in the shape of a real one: a localized home page
 * (single), a list of boats with galleries, a list of tours.
 */
import type { LegacySchema } from '../../src/index.js';

export const legacySchema: LegacySchema = {
  collections: [
    {
      key: 'content',
      file: 'app/data/content.json',
      idField: 'id',
      label: { it: 'Testi del sito (home)', en: 'Site copy (home)' },
      fields: [
        { path: 'it.hero.title', kind: 'text', label: { it: 'IT · hero › title', en: 'IT · hero › title' } },
        { path: 'en.hero.title', kind: 'text', label: { it: 'EN · hero › title', en: 'EN · hero › title' } },
        { path: 'it.hero.subtitle', kind: 'multiline', label: { it: 'IT · hero › subtitle', en: 'IT · hero › subtitle' } },
        { path: 'hero.video', kind: 'video', label: { it: 'Video hero', en: 'Hero video' } },
      ],
    },
    {
      key: 'fleet',
      file: 'app/data/fleet.json',
      idField: 'slug',
      label: { it: 'Flotta', en: 'Fleet' },
      fields: [
        { path: 'it.tagline', kind: 'text', label: { it: 'Slogan (IT)', en: 'Tagline (IT)' } },
        { path: 'cover', kind: 'image', label: { it: 'Copertina', en: 'Cover' } },
        { path: 'gallery', kind: 'imageList', label: { it: 'Galleria', en: 'Gallery' } },
        { path: 'it.highlights', kind: 'list', label: { it: 'Punti forti', en: 'Highlights' } },
      ],
    },
    {
      key: 'tours',
      file: 'app/data/tours.json',
      idField: 'slug',
      label: { it: 'Tour', en: 'Tours' },
      fields: [
        { path: 'it.name', kind: 'text', label: { it: 'Nome (IT)', en: 'Name (IT)' } },
        { path: 'price', kind: 'text', label: { it: 'Prezzo', en: 'Price' } },
      ],
    },
  ],
};

export const files: Record<string, string> = {
  'app/data/content.json':
    JSON.stringify(
      [
        {
          id: 'home',
          it: { hero: { title: 'Benvenuti a Capri', subtitle: 'Il mare\ncome non lo hai mai visto' } },
          en: { hero: { title: 'Welcome to Capri', subtitle: 'The sea' } },
          hero: { video: '/hero-video.mp4' },
          internal: { analyticsId: 'do-not-touch' },
        },
      ],
      null,
      2,
    ) + '\n',
  'app/data/fleet.json':
    JSON.stringify(
      [
        {
          slug: 'libeccio',
          it: { name: 'Libeccio', tagline: 'Veloce e comodo', highlights: ['8 posti', 'Bagno'] },
          cover: '/fleet/libeccio/cover.jpg',
          gallery: ['/fleet/libeccio/1.jpg', '/fleet/libeccio/2.jpg', '/fleet/libeccio/3.jpg'],
          specs: { length: '10 m' },
        },
        {
          slug: 'gabbiano',
          it: { name: 'Gabbiano', tagline: 'Classico', highlights: [] },
          cover: '/fleet/gabbiano/cover.jpg',
          gallery: ['/fleet/gabbiano/1.jpg'],
          specs: { length: '8 m' },
        },
      ],
      null,
      4,
    ) + '\n',
  'app/data/tours.json':
    JSON.stringify(
      [
        { slug: 'giro-isola', it: { name: "Giro dell'isola" }, price: '€ 120' },
        { slug: 'capri-positano', it: { name: 'Capri e Positano' }, price: '€ 250' },
      ],
      null,
      2,
    ) + '\n',
};
