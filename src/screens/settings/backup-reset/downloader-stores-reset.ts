import { DEFAULT_DUPLICATE_ACTION } from '@/downloads/v2/duplicate-action';
import { useDuplicateActionStore } from '@/downloads/v2/duplicate-action-store';
import { useNetworkOptionsStore } from '@/downloads/v2/network-options-store';
import { useSaveLocationStore } from '@/downloads/v2/save-location-store';
import { useSubtitleSettingsStore } from '@/downloads/v2/subtitle-store';
import { DEFAULT_SUBTITLE_MODE } from '@/downloads/v2/subtitles';
import { getTreeExportPort } from '@/downloads/v2/tree-export-port';

/**
 * Reset Settings (#470), the settings kept outside the settings store: "When a video is already downloaded", subtitles,
 * "Also save a copy to…" (the folder grant is given back) and Advanced network. App Lock and everything the user saved
 * (downloads, videos, history, tags, notes) are not touched.
 */
export function resetDownloaderStores(): void {
  useDuplicateActionStore.getState().setAction(DEFAULT_DUPLICATE_ACTION);
  const subtitles = useSubtitleSettingsStore.getState();
  subtitles.setEnabled(false);
  subtitles.setMode(DEFAULT_SUBTITLE_MODE);
  const folder = useSaveLocationStore.getState().treeUri;
  useSaveLocationStore.getState().dispatch({ type: 'remove' });
  if (folder) {
    void getTreeExportPort()?.releaseFolderAccess(folder).catch(() => undefined);
  }
  useNetworkOptionsStore.getState().reset();
}
