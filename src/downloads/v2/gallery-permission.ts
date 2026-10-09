/**
 * WRITE_EXTERNAL_STORAGE for the automatic gallery copy on Android 7–9 (API 24–28), where a copy in `Movies/VidoraX`
 * needs it. From Android 10 the engine publishes through MediaStore, which needs no permission at all. Never a gate:
 * a refusal only means the video stays in VidoraX without a gallery copy — the download itself is unaffected.
 */

import * as ReactNative from 'react-native';

import { logV2Download } from './diagnostics';

export type GalleryPermissionDecision = 'not-required' | 'granted' | 'ask' | 'denied';

/** Android 10+ (API 29) publishes to MediaStore without a storage permission. */
export function decideGalleryPermission(input: {
  platform: string;
  version: number | string;
  granted: boolean;
  alreadyAsked: boolean;
}): GalleryPermissionDecision {
  if (input.platform !== 'android') {
    return 'not-required';
  }
  if (typeof input.version !== 'number' || input.version >= 29) {
    return 'not-required';
  }
  if (input.granted) {
    return 'granted';
  }
  // One prompt per app run, like the notification permission: asking on every tap is noise.
  return input.alreadyAsked ? 'denied' : 'ask';
}

let asked = false;

export function resetGalleryPermissionPromptForTests(): void {
  asked = false;
}

/** Asks once, from the gesture that started a download. Never throws, never blocks the download. */
export async function ensureGalleryPermission(): Promise<GalleryPermissionDecision> {
  try {
    const permissions = ReactNative.PermissionsAndroid;
    const name = permissions?.PERMISSIONS?.WRITE_EXTERNAL_STORAGE;
    if (!permissions || !name) {
      return 'not-required';
    }
    const decisionInput = {
      platform: ReactNative.Platform.OS,
      version: ReactNative.Platform.Version,
      alreadyAsked: asked,
    };
    // Checked only where it matters: on Android 10+ the permission does not exist for this app.
    if (decideGalleryPermission({ ...decisionInput, granted: false }) === 'not-required') {
      return 'not-required';
    }
    const granted = await permissions.check(name).catch(() => false);
    const decision = decideGalleryPermission({ ...decisionInput, granted });
    if (decision !== 'ask') {
      return decision;
    }
    asked = true;
    const result = await permissions.request(name);
    const outcome: GalleryPermissionDecision = result === permissions.RESULTS.GRANTED ? 'granted' : 'denied';
    logV2Download('gallery_permission', { state: outcome });
    return outcome;
  } catch {
    return 'not-required';
  }
}
