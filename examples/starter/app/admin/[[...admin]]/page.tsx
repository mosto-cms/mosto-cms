import { adminMetadata, createAdminPage } from '@mosto-cms/next/admin';

import { cms } from '../../../mosto-cms.config';

export const metadata = adminMetadata;
export const dynamic = 'force-dynamic';

export default createAdminPage(cms);
