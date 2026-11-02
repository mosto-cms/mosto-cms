import { mostoField } from '@mosto-cms/next';

import { content } from '../../mosto-cms.config';
import { Gallery } from './gallery';

type Copy = { hero: { title: string; subtitle: string }; highlights: string[] };
type Home = { en: Copy; it: Copy; hero: { image: string }; gallery: string[] };
type Product = { slug: string; en: { name: string; description: string }; it: { name: string; description: string }; price: string };

const HOME = 'home:home';

export async function HomePage({ locale }: { locale: 'en' | 'it' }) {
  const home = await content.entry<Home>('home');
  const products = await content.collection<Product>('products');
  if (!home) return null;
  const copy = home[locale];

  return (
    <main lang={locale} style={{ maxWidth: 720, margin: '0 auto', padding: '48px 24px 96px' }}>
      <nav style={{ display: 'flex', gap: 16, fontSize: 14, marginBottom: 32 }}>
        <a href="/" aria-current={locale === 'en' ? 'page' : undefined}>English</a>
        <a href="/it" aria-current={locale === 'it' ? 'page' : undefined}>Italiano</a>
      </nav>
      <img {...mostoField(HOME, 'hero.image')} src={home.hero.image} alt="" width={720} height={240} style={{ width: '100%', height: 'auto', borderRadius: 12, display: 'block' }} />
      <h1 {...mostoField(HOME, `${locale}.hero.title`)} style={{ fontSize: 40, lineHeight: 1.15, margin: '32px 0 12px' }}>
        {copy.hero.title}
      </h1>
      <p {...mostoField(HOME, `${locale}.hero.subtitle`, null, { kind: 'multiline' })} style={{ whiteSpace: 'pre-line', fontSize: 18, color: '#555' }}>
        {copy.hero.subtitle}
      </p>
      <ul style={{ display: 'flex', gap: 12, padding: 0, listStyle: 'none', flexWrap: 'wrap' }}>
        {copy.highlights.map((h, i) => (
          <li key={i} {...mostoField(HOME, `${locale}.highlights`, i)} style={{ padding: '6px 12px', border: '1px solid #ddd', borderRadius: 99 }}>
            {h}
          </li>
        ))}
      </ul>
      <Gallery photos={home.gallery} label={locale === 'it' ? 'Galleria' : 'Gallery'} />
      <h2 style={{ marginTop: 48 }}>Menu</h2>
      {products.map((p) => (
        <article key={p.slug} style={{ display: 'flex', justifyContent: 'space-between', gap: 24, padding: '16px 0', borderTop: '1px solid #e6e3dc' }}>
          <div>
            <h3 {...mostoField({ collection: 'products', id: p.slug }, `${locale}.name`)} style={{ margin: 0 }}>
              {p[locale].name}
            </h3>
            <p {...mostoField({ collection: 'products', id: p.slug }, `${locale}.description`)} style={{ margin: '4px 0 0', color: '#666' }}>
              {p[locale].description}
            </p>
          </div>
          <strong {...mostoField({ collection: 'products', id: p.slug }, 'price')} data-testid={`price-${p.slug}`}>
            {p.price}
          </strong>
        </article>
      ))}
    </main>
  );
}
