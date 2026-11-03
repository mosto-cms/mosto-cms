import { createRouteHandlers } from '@mosto-cms/next';

import { cms } from '../../../../mosto-cms.config';

const handlers = createRouteHandlers(cms);

export const GET = handlers.GET;
export const POST = handlers.POST;
