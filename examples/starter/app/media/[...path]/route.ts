// Serves uploads (schema media.publicPath "/media") straight from the content
// store, so a photo uploaded from /admin shows at once, without a rebuild.
import { createMediaHandler } from '@mosto-cms/next';

import { source } from '../../../mosto-cms.config';
import schema from '../../../mosto-cms.schema.json';

export const GET = createMediaHandler({ schema, source });
export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';
