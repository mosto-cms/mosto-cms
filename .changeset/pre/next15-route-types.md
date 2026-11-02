---
"@mosto-cms/next": patch
---

Route handlers now type their second argument as required, so `export const GET = handlers.GET` builds on Next.js 15 as well as 16 (Next.js 15 rejects an optional context at build time). Missing params are still tolerated at runtime.
