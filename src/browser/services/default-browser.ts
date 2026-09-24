/**
 * Being the device's browser. The system owns the decision: VidoraX can only report the current state and open
 * the system's own dialog.
 */

import { getVidoraWeb, isVidoraWebAvailable } from '@modules/vidorax-web';

export type DefaultBrowserState = {
  /** VidoraX currently opens web links on this device. */
  isDefault: boolean;
  /** There is a way to ask (the role exists and is not already ours). */
  canRequest: boolean;
};

export function readDefaultBrowserState(): DefaultBrowserState {
  if (!isVidoraWebAvailable()) {
    return { isDefault: false, canRequest: false };
  }
  try {
    const web = getVidoraWeb();
    return { isDefault: web.isDefaultBrowser(), canRequest: web.canRequestDefaultBrowser() };
  } catch {
    return { isDefault: false, canRequest: false };
  }
}

/** Opens the system dialog. Returns false when the device offered nothing to open. */
export async function requestDefaultBrowser(): Promise<boolean> {
  if (!isVidoraWebAvailable()) {
    return false;
  }
  try {
    return await getVidoraWeb().requestDefaultBrowser();
  } catch {
    return false;
  }
}
