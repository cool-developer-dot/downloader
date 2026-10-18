import { getV2Engine } from '@/downloads/v2/engine-port';

import { useMediaTagsStore } from './media-tags-store';

const LISTENER_KEY = '__vidoraxMediaTagCleanup';

/**
 * An item's tags go with it: when library items are deleted (from VidoraX, or moved elsewhere), their artist is
 * forgotten. Kept on `globalThis`, so a Fast Refresh replaces the listener instead of adding a second one.
 */
export function ensureMediaTagCleanup(): void {
  const engine = getV2Engine();
  if (!engine) {
    return;
  }
  const slot = globalThis as unknown as Record<string, { remove(): void } | undefined>;
  try {
    slot[LISTENER_KEY]?.remove();
  } catch {
    // already gone
  }
  slot[LISTENER_KEY] = engine.addListener('onLibraryChange', ({ reason, ids }) => {
    if (reason === 'deleted' && ids.length > 0) {
      useMediaTagsStore.getState().forget(ids);
    }
  });
}
