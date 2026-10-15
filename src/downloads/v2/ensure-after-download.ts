import { AppState } from 'react-native';

import { downloadDetailsPath, navigation, openPlayer } from '@/navigation';
import { useAppLockStore } from '@/security/app-lock';
import { useSettingsStore } from '@/store/settings';

import { createAfterDownloadController, normalizeAfterDownloadAction } from './after-download';
import { getV2Engine } from './engine-port';
import { ensureGalleryPermission } from './gallery-permission';

let attached = false;

function isLocked(): boolean {
  const lock = useAppLockStore.getState();
  return lock.isEnabled && lock.status !== 'UNLOCKED';
}

/** In front and unlocked: the only time Open/Play may navigate. */
function isForeground(): boolean {
  return AppState.currentState === 'active' && !isLocked();
}

/**
 * Post-download Action (#156, #361): listens to the v2 engine's own state events and runs the chosen action when a
 * download completes. Idempotent; a build without the native module does nothing.
 */
export function ensureAfterDownloadAction(): void {
  if (attached) {
    return;
  }
  const engine = getV2Engine();
  if (!engine) {
    return;
  }
  attached = true;
  const controller = createAfterDownloadController({
    getAction: () => normalizeAfterDownloadAction(useSettingsStore.getState().afterDownloadAction),
    isForeground,
    autoSaveToGallery: () => useSettingsStore.getState().saveToGallery,
    openDetails: (id) => navigation.push(downloadDetailsPath(id)),
    play: (id) => openPlayer(id),
    saveToGallery: async (id) => {
      // Android 9 and older need storage permission; only ask while the user can see the prompt.
      if (isForeground()) {
        await ensureGalleryPermission();
      }
      await engine.saveToGallery([id]);
    },
    schedule: (run, ms) => setTimeout(run, ms),
    cancel: (handle) => clearTimeout(handle as ReturnType<typeof setTimeout>),
  });
  engine.addListener('onDownloadStateChange', ({ record }) => {
    if (record.state !== 'completed') {
      return;
    }
    try {
      controller.onCompleted({ id: record.libraryItemId ?? record.id, completedAt: record.updatedAt });
    } catch {
      // The action must never disturb downloads.
    }
  });
}
