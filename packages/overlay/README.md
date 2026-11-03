# @mosto-cms/overlay

The click-to-edit layer of [Mosto CMS](https://github.com/mosto-cms/mosto-cms). It runs on the
live site and does nothing for normal visitors: it wakes up only when the page is opened as
`?mostoEdit=1` inside the `/admin` iframe and the admin completes the handshake from an allowed
origin. In Edit mode annotated elements are outlined on hover with their name, a click (or
Enter) selects one, texts are edited in place (`contenteditable`, Enter applies, Esc cancels)
and links do not navigate; in Browse mode the page behaves normally. The admin can also update
any field in place while the editor types in its panel. No dependencies.

```tsx
import { mostoField } from '@mosto-cms/overlay';

<h1 {...mostoField('home:home', 'en.hero.title')}>{home.en.hero.title}</h1>
<img {...mostoField({ collection: 'fleet', id: boat.slug }, 'gallery', 2, { kind: 'image' })} src={src} alt="" />
```

With Next.js, mount the overlay once in the root layout: `import { MostoOverlay } from
'@mosto-cms/next/overlay'`. Elsewhere call `initMostoOverlay()` from the browser.

- Messages and origin rules: [protocol §5](../../docs/protocol.md#5-visual-editor-messages).
- Stacked frames (carousels, galleries): a click selects the annotated element that is actually
  visible at that point, not the last one in the DOM.
- `next/image` URLs (`/_next/image?url=…`) are reported as the clean source path.

MIT licensed.
