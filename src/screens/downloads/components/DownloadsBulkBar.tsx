import { memo, useCallback, useState } from 'react';

import { Box } from '@/components/base/Box';
import { Text } from '@/components/base/Text';
import { Button } from '@/components/buttons/Button';
import { ConfirmModal } from '@/components/modals/ConfirmModal';
import { useTranslation } from '@/localization';

import { useDownloadsBulkActions } from '../hooks/useDownloadsBulkActions';
import { useDownloadsTokens } from '../theme/downloads-tokens';

export type DownloadsBulkBarProps = {
  testID?: string;
};

/**
 * Pause All (#327), Resume All (#328), Cancel All (#329) under the Downloads header. Shown only while a v2 download
 * is queued, running or paused; each button is disabled when nothing applies to it.
 */
export const DownloadsBulkBar = memo(function DownloadsBulkBar({
  testID = 'downloads-bulk-bar',
}: DownloadsBulkBarProps) {
  const downloadsTokens = useDownloadsTokens();
  const { t, tp } = useTranslation();
  const { summary, busy, error, clearError, pauseAll, resumeAll, cancelAll } = useDownloadsBulkActions();
  const [confirm, setConfirm] = useState<'pause' | 'cancel' | null>(null);

  const pauseCount = summary.pausableIds.length;
  const resumeCount = summary.resumableIds.length;
  const cancelCount = summary.cancellableIds.length;

  const handlePauseAll = useCallback(() => {
    clearError();
    // One warning for the whole batch, only when some of it cannot resume.
    if (summary.pauseRestartCount > 0) {
      setConfirm('pause');
      return;
    }
    void pauseAll();
  }, [clearError, pauseAll, summary.pauseRestartCount]);

  const handleResumeAll = useCallback(() => {
    clearError();
    void resumeAll();
  }, [clearError, resumeAll]);

  const handleCancelAll = useCallback(() => {
    clearError();
    setConfirm('cancel');
  }, [clearError]);

  const closeConfirm = useCallback(() => setConfirm(null), []);

  const confirmPause = useCallback(() => {
    setConfirm(null);
    void pauseAll();
  }, [pauseAll]);

  const confirmCancel = useCallback(() => {
    setConfirm(null);
    void cancelAll();
  }, [cancelAll]);

  if (cancelCount === 0) {
    return null;
  }

  return (
    <Box
      px={downloadsTokens.spacing.screenX}
      gap={6}
      testID={testID}
      accessibilityLabel={t('downloadBulk.barA11y')}>
      <Box row gap={8} style={{ flexWrap: 'wrap' }}>
        <Button
          title={t('downloadBulk.pauseAll')}
          variant="outline"
          size="small"
          leftIcon="pause"
          onPress={handlePauseAll}
          disabled={pauseCount === 0 || busy != null}
          loading={busy === 'pauseAll'}
          accessibilityHint={t('downloadBulk.pauseAllHint')}
          testID={`${testID}-pause-all`}
        />
        <Button
          title={t('downloadBulk.resumeAll')}
          variant="outline"
          size="small"
          leftIcon="play"
          onPress={handleResumeAll}
          disabled={resumeCount === 0 || busy != null}
          loading={busy === 'resumeAll'}
          accessibilityHint={t('downloadBulk.resumeAllHint')}
          testID={`${testID}-resume-all`}
        />
        <Button
          title={t('downloadBulk.cancelAll')}
          variant="outline"
          size="small"
          leftIcon="close"
          onPress={handleCancelAll}
          disabled={busy != null}
          loading={busy === 'cancelAll'}
          accessibilityHint={t('downloadBulk.cancelAllHint')}
          testID={`${testID}-cancel-all`}
        />
      </Box>

      {error ? (
        <Text variant="caption" color="error" accessibilityLiveRegion="polite">
          {t(`downloadBulk.${error}`)}
        </Text>
      ) : null}

      <ConfirmModal
        visible={confirm === 'pause'}
        variant="warning"
        title={t('downloadBulk.pauseAllTitle')}
        message={`${t('downloads.pauseUnsupported')}\n${t('downloadBulk.pauseRestartAffected', {
          downloads: tp('plurals.downloadsOther', summary.pauseRestartCount),
        })}`}
        confirmLabel={t('downloadBulk.pauseAll')}
        cancelLabel={t('common.cancel')}
        onConfirm={confirmPause}
        onCancel={closeConfirm}
        testID={`${testID}-pause-confirm`}
      />

      <ConfirmModal
        visible={confirm === 'cancel'}
        variant="delete"
        title={t('downloadBulk.cancelAllTitle')}
        message={t('downloadBulk.cancelAllMessage', {
          downloads: tp('plurals.downloadsOther', cancelCount),
        })}
        confirmLabel={t('downloadBulk.cancelAll')}
        cancelLabel={t('downloadBulk.keepDownloading')}
        onConfirm={confirmCancel}
        onCancel={closeConfirm}
        testID={`${testID}-cancel-confirm`}
      />
    </Box>
  );
});
