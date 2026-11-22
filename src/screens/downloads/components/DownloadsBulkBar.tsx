import { memo, useCallback, useState } from 'react';
import { View } from 'react-native';

import { ConfirmModal } from '@/components/modals/ConfirmModal';
import { DsButton, DsButtonRow, DsText } from '@/design';
import { useTranslation } from '@/localization';

import type { useDownloadsBulkActions } from '../hooks/useDownloadsBulkActions';

export type DownloadsBulkActionsModel = ReturnType<typeof useDownloadsBulkActions>;

export type DownloadsBulkBarProps = {
  /** The screen's one `useDownloadsBulkActions()` (shared with the "Cancel all" item of the Add-link sheet). */
  bulk: DownloadsBulkActionsModel;
  /** Set by the screen when "Cancel all" was chosen elsewhere: the confirmation opens here. */
  cancelConfirmVisible?: boolean;
  onCancelConfirmClosed?: () => void;
  testID?: string;
};

/**
 * Pause All (#327) and Resume All (#328) as the design's button pair under the speed card; Cancel All (#329) keeps
 * its confirmation here and is reached from the "+ Add link" long-press sheet. Shown only while a v2 download is
 * queued, running or paused; a button is disabled when nothing applies to it.
 */
export const DownloadsBulkBar = memo(function DownloadsBulkBar({
  bulk,
  cancelConfirmVisible = false,
  onCancelConfirmClosed,
  testID = 'downloads-bulk-bar',
}: DownloadsBulkBarProps) {
  const { t, tp } = useTranslation();
  const { summary, busy, error, clearError, pauseAll, resumeAll, cancelAll } = bulk;
  const [pauseConfirm, setPauseConfirm] = useState(false);

  const pauseCount = summary.pausableIds.length;
  const resumeCount = summary.resumableIds.length;
  const cancelCount = summary.cancellableIds.length;

  const handlePauseAll = useCallback(() => {
    clearError();
    // One warning for the whole batch, only when some of it cannot resume.
    if (summary.pauseRestartCount > 0) {
      setPauseConfirm(true);
      return;
    }
    void pauseAll();
  }, [clearError, pauseAll, summary.pauseRestartCount]);

  const handleResumeAll = useCallback(() => {
    clearError();
    void resumeAll();
  }, [clearError, resumeAll]);

  const closePauseConfirm = useCallback(() => setPauseConfirm(false), []);

  const confirmPause = useCallback(() => {
    setPauseConfirm(false);
    void pauseAll();
  }, [pauseAll]);

  const closeCancelConfirm = useCallback(() => {
    onCancelConfirmClosed?.();
  }, [onCancelConfirmClosed]);

  const confirmCancel = useCallback(() => {
    onCancelConfirmClosed?.();
    clearError();
    void cancelAll();
  }, [cancelAll, clearError, onCancelConfirmClosed]);

  if (cancelCount === 0) {
    return null;
  }

  return (
    <View testID={testID} accessibilityLabel={t('downloadBulk.barA11y')} style={{ gap: 6 }}>
      <DsButtonRow>
        <DsButton
          flex
          variant="primary"
          icon="pause"
          label={t('downloadBulk.pauseAll')}
          onPress={handlePauseAll}
          disabled={pauseCount === 0 || busy != null}
          loading={busy === 'pauseAll'}
          accessibilityHint={t('downloadBulk.pauseAllHint')}
          testID={`${testID}-pause-all`}
        />
        <DsButton
          flex
          variant="secondary"
          icon="play"
          label={t('downloadBulk.resumeAll')}
          onPress={handleResumeAll}
          disabled={resumeCount === 0 || busy != null}
          loading={busy === 'resumeAll'}
          accessibilityHint={t('downloadBulk.resumeAllHint')}
          testID={`${testID}-resume-all`}
        />
      </DsButtonRow>

      {error ? (
        <DsText variant="rowSub" color="error" accessibilityLiveRegion="polite">
          {t(`downloadBulk.${error}`)}
        </DsText>
      ) : null}

      <ConfirmModal
        visible={pauseConfirm}
        variant="warning"
        title={t('downloadBulk.pauseAllTitle')}
        message={`${t('downloads.pauseUnsupported')}\n${t('downloadBulk.pauseRestartAffected', {
          downloads: tp('plurals.downloadsOther', summary.pauseRestartCount),
        })}`}
        confirmLabel={t('downloadBulk.pauseAll')}
        cancelLabel={t('common.cancel')}
        onConfirm={confirmPause}
        onCancel={closePauseConfirm}
        testID={`${testID}-pause-confirm`}
      />

      <ConfirmModal
        visible={cancelConfirmVisible}
        variant="delete"
        title={t('downloadBulk.cancelAllTitle')}
        message={t('downloadBulk.cancelAllMessage', {
          downloads: tp('plurals.downloadsOther', cancelCount),
        })}
        confirmLabel={t('downloadBulk.cancelAll')}
        cancelLabel={t('downloadBulk.keepDownloading')}
        onConfirm={confirmCancel}
        onCancel={closeCancelConfirm}
        testID={`${testID}-cancel-confirm`}
      />
    </View>
  );
});
