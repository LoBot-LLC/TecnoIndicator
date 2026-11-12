// DEPRECATED: TinyFish API keys removed. This file provides backward compatibility
// by re-exporting the webSearchRouter. All new code should import from webSearchRouter.ts directly.
//
// Migration:
// - tinyfishRouter.tinyfishSearch() -> webSearchRouter.webSearch()
// - tinyfishRouter.tinyfishScrape() -> webSearchRouter.webScrape()
// - tinyfishRouter.getTinyfishStatus() -> webSearchRouter.getWebSearchStatus()

import { tinyfishRouter as compatRouter } from "./webSearchRouter";

// Re-export the compatibility router so existing imports don't break immediately.
// These will be removed in a future version after all handlers are migrated.
export const tinyfishRouter = compatRouter;