# @mosto-cms/admin

The `/admin` interface of [Mosto CMS](https://github.com/mosto-cms/mosto-cms), made for people
who run a small business, not for developers:

- **On the page**: the site in a frame; click a text, a photo, a video or one photo of a
  gallery, edit it in a side panel (a bottom sheet on phones), watch the page change while
  typing, then Publish. All edits go out together as one commit.
- **All content**: every editable field as a form, grouped by page or list, with the site's
  languages side by side.
- **History**: recent publishes with Undo (`revert`), asking again if something changed since.
- **Uploads**: photos compressed in the browser (longest side 2400 px, WebP when accepted),
  size and type checked before sending.
- Plain-language errors (someone else changed this, session ended, file too big), English and
  Italian (from the browser, switchable), keyboard and screen-reader friendly, usable on a
  phone. A small "Powered by Mosto CMS" link that can be turned off.

It talks only to the site's own `/api/mosto-cms` route with the editor's session cookie and has
no dependency on any hosted service. With Next.js you do not use it directly:
`createAdminPage()` from `@mosto-cms/next/admin` mounts it. Elsewhere:

```tsx
import { MostoAdmin } from '@mosto-cms/admin';

<MostoAdmin apiPath="/api/mosto-cms" siteName="Trattoria" editor={signedInEditorOrNull} pages={[{ path: '/' }]} />
```

React 19. MIT licensed.
