import { getVidoraWeb, isVidoraWebAvailable } from '@modules/vidorax-web';

import { withExpectedSystemScreen } from '@/security/app-lock/expected-system-screen';
import { useSettingsStore } from '@/store/settings';

import { readStartPagePhoto } from './start-page-background';

/** Longer side of the stored copy: sharp on any phone screen, small on disk. */
const PHOTO_MAX_SIZE = 1920;

export type PickPhotoOutcome = 'picked' | 'cancelled' | 'failed' | 'unavailable';

/**
 * B21 #245 — picks the start page's photo with Android's Photo Picker (VidoraWeb; no permission) and makes it the
 * background. The picker is a system screen of this action: App Lock does not relock for it.
 */
export async function pickStartPagePhoto(): Promise<PickPhotoOutcome> {
  if (!isVidoraWebAvailable()) return 'unavailable';
  const web = getVidoraWeb();
  if (!web.pickStartPageImage) return 'unavailable';
  try {
    const result = await withExpectedSystemScreen(() => web.pickStartPageImage!(PHOTO_MAX_SIZE));
    if (result == null) return 'cancelled';
    if ('error' in result) return 'failed';
    const uri = readStartPagePhoto(result.uri);
    if (!uri) return 'failed';
    const update = useSettingsStore.getState().updateSetting;
    update('startPageBackgroundPhoto', uri);
    update('startPageBackground', 'photo');
    return 'picked';
  } catch {
    return 'failed';
  }
}

/** Back to the theme; the stored copy is deleted. */
export async function removeStartPagePhoto(): Promise<void> {
  const update = useSettingsStore.getState().updateSetting;
  update('startPageBackgroundPhoto', '');
  if (useSettingsStore.getState().startPageBackground === 'photo') update('startPageBackground', 'theme');
  if (!isVidoraWebAvailable()) return;
  try {
    await getVidoraWeb().clearStartPageImage?.();
  } catch {
    // The file is the app's own; it is replaced by the next photo anyway.
  }
}
