# @mosto-cms/overlay

## 0.1.0-alpha.1

### Minor Changes

- Visual editor with two modes, Edit and Browse. Edit (the default) outlines editable elements on hover with their name, marks other content as not editable, edits texts in place on the page (Enter or leaving the field applies to the draft, Esc cancels) and keeps links from navigating. Browse leaves the site alone so links work, and the editor follows to the next page. E switches mode, Esc clears the selection. New messages `mosto:mode`, `mosto:edit`, `mosto:deselect`; `mosto:init` takes `mode` and `labels`, `mosto:select` reports `inline`.

## 0.1.0-alpha.0

### Minor Changes

- 85c0265: The `/admin` interface (visual mode, forms with languages side by side, history with undo, uploads with in-browser compression, English and Italian, phone layout) and the click-to-edit overlay with origin-checked messages and `mostoField()`. The fs adapter can commit with git (`git: true`) for local history. `describe` returns upload limits and `listEditableFields` the content file. SVG uploads are now off by default.

### Patch Changes

- Every package now ships the MIT licence file.
