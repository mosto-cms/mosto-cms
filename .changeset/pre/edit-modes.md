---
"@mosto-cms/overlay": minor
"@mosto-cms/admin": minor
---

Visual editor with two modes, Edit and Browse. Edit (the default) outlines editable elements on hover with their name, marks other content as not editable, edits texts in place on the page (Enter or leaving the field applies to the draft, Esc cancels) and keeps links from navigating. Browse leaves the site alone so links work, and the editor follows to the next page. E switches mode, Esc clears the selection. New messages `mosto:mode`, `mosto:edit`, `mosto:deselect`; `mosto:init` takes `mode` and `labels`, `mosto:select` reports `inline`.
