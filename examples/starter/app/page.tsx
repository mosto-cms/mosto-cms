import { content } from '../mosto-cms.config';

// Static page, regenerated on demand: /api/mosto-cms expires it right after a publish.
export const revalidate = 3600;

type Home = {
  en: { hero: { title: string; subtitle: string }; highlights: string[] };
  hero: { image: string };
};
type Product = { slug: string; en: { name: string; description: string }; price: string };

/** The annotation the visual editor uses to find an editable element: `<collection>:<id>:<path>`. */
const field = (collection: string, id: string, path: string) => ({ 'data-mosto-field': `${collection}:${id}:${path}` });

export default async function HomePage() {
  const home = await content.entry<Home>('home');
  const products = await content.collection<Product>('products');
  if (!home) return null;

  return (
    <main style={{ maxWidth: 720, margin: '0 auto', padding: '64px 24px' }}>
      <img {...field('home', 'home', 'hero.image')} data-mosto-kind="image" src={home.hero.image} alt="" width={720} height={240} style={{ width: '100%', height: 'auto', borderRadius: 12 }} />
      <h1 {...field('home', 'home', 'en.hero.title')} style={{ fontSize: 40, margin: '32px 0 12px' }}>
        {home.en.hero.title}
      </h1>
      <p {...field('home', 'home', 'en.hero.subtitle')} style={{ whiteSpace: 'pre-line', fontSize: 18, color: '#555' }}>
        {home.en.hero.subtitle}
      </p>
      <ul style={{ display: 'flex', gap: 12, padding: 0, listStyle: 'none', flexWrap: 'wrap' }}>
        {home.en.highlights.map((h, i) => (
          <li key={i} {...field('home', 'home', `en.highlights.${i}`)} style={{ padding: '6px 12px', border: '1px solid #ddd', borderRadius: 99 }}>
            {h}
          </li>
        ))}
      </ul>
      <h2 style={{ marginTop: 48 }}>Menu</h2>
      {products.map((p) => (
        <article key={p.slug} style={{ display: 'flex', justifyContent: 'space-between', gap: 24, padding: '16px 0', borderTop: '1px solid #e6e3dc' }}>
          <div>
            <h3 {...field('products', p.slug, 'en.name')} style={{ margin: 0 }}>{p.en.name}</h3>
            <p {...field('products', p.slug, 'en.description')} style={{ margin: '4px 0 0', color: '#666' }}>{p.en.description}</p>
          </div>
          <strong {...field('products', p.slug, 'price')} data-testid={`price-${p.slug}`}>{p.price}</strong>
        </article>
      ))}
    </main>
  );
}
