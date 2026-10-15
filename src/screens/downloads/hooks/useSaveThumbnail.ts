import { useCallback } from 'react';
import { AccessibilityInfo, Platform, ToastAndroid } from 'react-native';

import { getV2Engine, isEngineOwned } from '@/downloads/v2';
import { ensureGalleryPermission } from '@/downloads/v2/gallery-permission';
import { canSaveThumbnail, thumbnailSaveFailure } from '@/downloads/v2/thumbnail-save';
import { useTranslation } from '@/localization';
import { useDownloadsStore } from '@/store/downloads';

function announce(message: string): void {
  if (Platform.OS === 'android') {
    ToastAndroid.show(message, ToastAndroid.SHORT);
  }
  AccessibilityInfo.announceForAccessibility(message);
}

function sdkInt(): number {
  return Platform.OS === 'android' && typeof Platform.Version === 'number' ? Platform.Version : 0;
}

/** True when "Save thumbnail" applies to this row (see `canSaveThumbnail`). */
export function useCanSaveThumbnail(id: string | null | undefined): boolean {
  const status = useDownloadsStore((state) => (id ? state.itemsById[id]?.status ?? state.engineRowsById[id]?.status : undefined));
  const thumbnailUrl = useDownloadsStore((state) =>
    id ? state.itemsById[id]?.thumbnailUrl ?? state.engineRowsById[id]?.thumbnailUrl : undefined,
  );
  const engineOwned = useDownloadsStore((state) => (id ? isEngineOwned(state, id) : false));
  if (!id || Platform.OS !== 'android') {
    return false;
  }
  return canSaveThumbnail({
    engineOwned,
    status,
    thumbnailUrl,
    nativeAvailable: typeof getV2Engine()?.saveThumbnailToGallery === 'function',
    sdkInt: sdkInt(),
  });
}

/** Saves the thumbnail to the Gallery (Pictures/VidoraX) and says how it went. */
export function useSaveThumbnail() {
  const { t } = useTranslation();
  return useCallback(
    async (id: string) => {
      const engine = getV2Engine();
      if (!engine?.saveThumbnailToGallery) {
        announce(t('thumbnailSave.failed'));
        return;
      }
      try {
        await ensureGalleryPermission();
        await engine.saveThumbnailToGallery(id);
        announce(t('thumbnailSave.saved'));
      } catch (error) {
        const outcome = thumbnailSaveFailure(error);
        announce(
          outcome === 'permission'
            ? t('thumbnailSave.needsPermission')
            : outcome === 'missing'
              ? t('thumbnailSave.missing')
              : t('thumbnailSave.failed'),
        );
      }
    },
    [t],
  );
}
