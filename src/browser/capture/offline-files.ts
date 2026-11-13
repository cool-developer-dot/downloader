import { getVidoraWeb, isVidoraWebAvailable } from '@modules/vidorax-web';

import { offlineProfileKey } from './capture-core';

/**
 * B17 #178 — the saved-page files of a browser profile (`offline-pages/<profile>/`), deleted with the profile (B20's
 * delete and the guest's end). The rows go with the profile's database.
 */
export function deleteOfflinePagesOf(profileId: string): void {
  if (!isVidoraWebAvailable()) return;
  try {
    getVidoraWeb().deleteOfflineProfile?.(offlineProfileKey(profileId));
  } catch {
    // older native build: nothing was saved there
  }
}
