/**
 * Videos the user already has on the device. VidoraX only reads them: it lists what MediaStore reports and
 * plays it in place. Nothing is copied into the library, and nothing is ever written or deleted.
 */

import type { DeviceVideo } from '@modules/vidorax-media/src/VidoraMedia.types';

import { getV2Engine } from '@/downloads/v2';

const ID_PREFIX = 'device:';

export type DeviceVideoListing = {
  permissionGranted: boolean;
  /** `selected` means Android 14's "Select photos and videos": only what the user picked is visible. */
  access: 'none' | 'selected' | 'full';
  items: DeviceVideo[];
  /** False when this build has no native module at all. */
  available: boolean;
};

/** Media id used by the player route for a device video; distinct from any download id. */
export function deviceMediaId(video: DeviceVideo): string {
  return `${ID_PREFIX}${video.id}`;
}

export function isDeviceMediaId(mediaId: string | null | undefined): boolean {
  return typeof mediaId === 'string' && mediaId.startsWith(ID_PREFIX);
}

/** What the player needs: remembered as videos are listed, so opening one needs no second query. */
const known = new Map<string, DeviceVideo>();

export function rememberDeviceVideos(videos: DeviceVideo[]): void {
  for (const video of videos) {
    known.set(deviceMediaId(video), video);
  }
}

export function knownDeviceVideo(mediaId: string): DeviceVideo | null {
  return known.get(mediaId) ?? null;
}

export function forgetDeviceVideosForTests(): void {
  known.clear();
}

export async function listDeviceVideos(limit = 200, offset = 0): Promise<DeviceVideoListing> {
  const engine = getV2Engine();
  if (!engine || typeof engine.listDeviceVideos !== 'function') {
    return { permissionGranted: false, access: 'none', items: [], available: false };
  }
  try {
    const page = await engine.listDeviceVideos(limit, offset);
    rememberDeviceVideos(page.items);
    return {
      permissionGranted: page.permissionGranted,
      access: page.access ?? (page.permissionGranted ? 'full' : 'none'),
      items: page.items,
      available: true,
    };
  } catch {
    return { permissionGranted: false, access: 'none', items: [], available: true };
  }
}
