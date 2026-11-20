import { memo, useCallback, useEffect, useState } from 'react';
import { Alert } from 'react-native';

import { Box } from '@/components/base/Box';
import { Text } from '@/components/base/Text';
import { Button } from '@/components/buttons/Button';
import { canSaveCopyAs, saveCopyAs, saveCopyProgress } from '@/downloads/cloud/cloud-port';
import { deleteCompletedFileFromVidoraX } from '@/downloads/completed-file/delete/delete-service';
import { useTranslation } from '@/localization';
import { navigation } from '@/navigation';
import { formatUsagePercent } from '@/storage-manager/utils/format-bytes';

const PROGRESS_POLL_MS = 1_000;

/**
 * Download details → "Save a copy to…" (#512 Save to cloud): Android's save screen, where the user's cloud apps
 * appear; afterwards VidoraX offers to remove the video from the phone (the copy stays where it was saved).
 */
export const DownloadCloudSaveAction = memo(function DownloadCloudSaveAction({ id }: { id: string }) {
  const { t } = useTranslation();
  const [saving, setSaving] = useState(false);
  const [fraction, setFraction] = useState<number | null>(null);
  const [notice, setNotice] = useState<string | null>(null);

  useEffect(() => {
    if (!saving) return undefined;
    const timer = setInterval(() => setFraction(saveCopyProgress(id)), PROGRESS_POLL_MS);
    return () => clearInterval(timer);
  }, [id, saving]);

  const save = useCallback(async () => {
    setSaving(true);
    setNotice(null);
    setFraction(null);
    const result = await saveCopyAs(id);
    setSaving(false);
    if (result.status === 'cancelled') return;
    if (result.status === 'failed') {
      setNotice(t('cloud.saveFailed'));
      return;
    }
    setNotice(t('cloud.saved', { name: result.name }));
    Alert.alert(t('cloud.removeTitle'), t('cloud.removeBody', { name: result.name }), [
      { text: t('cloud.keep'), style: 'cancel' },
      {
        text: t('cloud.remove'),
        style: 'destructive',
        onPress: () => {
          void deleteCompletedFileFromVidoraX(id).then((removed) => {
            if (removed.ok) {
              navigation.back();
            } else {
              setNotice(t('cloud.removeFailed'));
            }
          });
        },
      },
    ]);
  }, [id, t]);

  if (!canSaveCopyAs()) return null;
  const percent = formatUsagePercent(fraction);
  return (
    <Box mt={8} gap={6} testID="download-details-cloud-save">
      <Button
        title={saving ? (percent ? t('cloud.savingProgress', { percent }) : t('cloud.saving')) : t('cloud.saveCopy')}
        variant="outline"
        size="small"
        leftIcon="cloud-upload-outline"
        loading={saving}
        onPress={() => void save()}
        accessibilityHint={t('cloud.saveCopyHint')}
        testID="download-details-cloud-save-button"
      />
      {notice ? (
        <Text variant="caption" color="textSecondary" accessibilityLiveRegion="polite">
          {notice}
        </Text>
      ) : null}
    </Box>
  );
});
