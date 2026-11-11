import { memo, useEffect, useState } from 'react';

import { Box } from '@/components/base/Box';
import { Text } from '@/components/base/Text';
import { Button } from '@/components/buttons/Button';
import { showInFolderTarget } from '@/downloads/v2/save-location';
import { useExternalCopiesStore, useFolderCopyStatusStore } from '@/downloads/v2/save-location-store';
import { showItemInFolder } from '@/downloads/v2/show-in-folder';
import { getTreeExportPort } from '@/downloads/v2/tree-export-port';
import { useTranslation } from '@/localization';
import { formatUsagePercent } from '@/storage-manager/utils/format-bytes';

/** How often the copy's progress is read while it runs (memory only on the native side). */
const PROGRESS_POLL_MS = 1_000;

export type DownloadSaveLocationActionProps = {
  id: string;
};

/**
 * Download details: the external copy of a completed item (#297) — its progress while it is being saved, then
 * "Show in folder" (#398). Renders nothing for an item without a copy, which is every item unless the user turned
 * "Also save a copy to…" on.
 */
export const DownloadSaveLocationAction = memo(function DownloadSaveLocationAction({
  id,
}: DownloadSaveLocationActionProps) {
  const { t } = useTranslation();
  const record = useExternalCopiesStore((s) => s.records[id]);
  const copying = useFolderCopyStatusStore((s) => s.activeId === id);
  const [fraction, setFraction] = useState<number | null>(null);

  useEffect(() => {
    const port = getTreeExportPort();
    if (!copying || !port) {
      return undefined;
    }
    const read = () => {
      try {
        const progress = port.getFolderCopyProgress(id);
        setFraction(progress && progress.totalBytes > 0 ? progress.bytesDone / progress.totalBytes : null);
      } catch {
        setFraction(null);
      }
    };
    const first = setTimeout(read, 0);
    const timer = setInterval(read, PROGRESS_POLL_MS);
    return () => {
      clearTimeout(first);
      clearInterval(timer);
    };
  }, [copying, id]);

  if (copying) {
    const percent = formatUsagePercent(fraction);
    return (
      <Box mt={8} testID="download-details-save-location-progress">
        <Text variant="caption" color="textSecondary" accessibilityLiveRegion="polite">
          {percent ? t('saveLocation.copyingProgress', { percent }) : t('saveLocation.copying')}
        </Text>
      </Box>
    );
  }

  const target = showInFolderTarget(record);
  if (!target) {
    return null;
  }
  return (
    <Box mt={8} gap={6} testID="download-details-save-location">
      <Text variant="caption" color="textSecondary" numberOfLines={2}>
        {t('saveLocation.copyIn', { folder: target.folderLabel ?? target.name })}
      </Text>
      <Button
        title={t('saveLocation.showInFolder')}
        variant="outline"
        onPress={() => {
          void showItemInFolder(id);
        }}
        fullWidth
        accessibilityHint={t('saveLocation.showInFolderHint')}
        testID="download-details-show-in-folder"
      />
    </Box>
  );
});
