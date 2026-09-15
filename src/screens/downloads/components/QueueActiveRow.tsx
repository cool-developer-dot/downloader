import { memo, useCallback } from 'react';

import { Box } from '@/components/base/Box';
import { Pressable } from '@/components/base/Pressable';
import { Text } from '@/components/base/Text';
import { IconButton } from '@/components/buttons/IconButton';
import { ProgressBar } from '@/components/common/ProgressBar';
import { resolveDownloadRuntimeActions } from '@/downloads/runtime-actions';
import { useTranslation } from '@/localization';
import { useDownloadsStore } from '@/store/downloads';

import { useDownloadsTokens } from '../theme/downloads-tokens';
import {
  buildProgressMeta,
  formatDownloadFileSize,
  formatTransferSpeed,
  getExecutionStatusLabel,
} from '../utils/download-format';

export type QueueActiveRowProps = {
  id: string;
  onPress: (id: string) => void;
  onPause: (id: string) => void;
  onResume: (id: string) => void;
  onCancel: (id: string) => void;
  mutating?: boolean;
};

export const QueueActiveRow = memo(function QueueActiveRow({
  id,
  onPress,
  onPause,
  onResume,
  onCancel,
  mutating = false,
}: QueueActiveRowProps) {
  const downloadsTokens = useDownloadsTokens();
  const { t } = useTranslation();
  const item = useDownloadsStore((s) => s.itemsById[id] ?? null);
  const transfer = useDownloadsStore((s) => s.transferById[id] ?? null);

  const handlePress = useCallback(() => onPress(id), [id, onPress]);
  const handlePause = useCallback(() => onPause(id), [id, onPause]);
  const handleResume = useCallback(() => onResume(id), [id, onResume]);
  const handleCancel = useCallback(() => onCancel(id), [id, onCancel]);

  if (!item) {
    return null;
  }

  const title = item.title?.trim() || item.fileName?.trim() || t('downloads.untitled');
  const quality = item.quality?.trim() || null;
  const size = formatDownloadFileSize(item.fileSize);
  const progress =
    transfer?.progress != null ? transfer.progress : item.progress;
  const speed = formatTransferSpeed(transfer?.bytesPerSecond ?? null);
  const progressMeta = buildProgressMeta(item, transfer);
  const runtime = resolveDownloadRuntimeActions({
    status: item.status,
    executionState: transfer?.executionState ?? null,
    workerState: item.workerState ?? transfer?.workerState ?? null,
    sourceSupportsResume: transfer?.supportsResume ?? null,
    hasActiveTransfer:
      transfer?.localState === 'transferring' ||
      transfer?.executionState === 'DOWNLOADING'
        ? true
        : transfer
          ? false
          : undefined,
  });

  const statusLabel = getExecutionStatusLabel({
    status: item.status,
    workerState: item.workerState,
    localState: transfer?.localState ?? null,
    downloadId: id,
  });
  const metaParts = [quality, size].filter(Boolean);
  const a11y = [
    title,
    statusLabel,
    t('downloads.percentA11y', { percent: Math.round(progress) }),
    quality,
    speed,
  ]
    .filter(Boolean)
    .join(', ');

  return (
    <Pressable
      onPress={handlePress}
      accessibilityRole="button"
      accessibilityLabel={a11y}
      testID={`queue-active-${id}`}
      style={{
        minHeight: 72,
        paddingVertical: 12,
        paddingHorizontal: downloadsTokens.spacing.screenX,
        borderBottomWidth: 1,
        borderBottomColor: downloadsTokens.cardBorder,
      }}>
      <Box gap={8}>
        <Box row style={{ justifyContent: 'space-between', alignItems: 'flex-start' }}>
          <Box style={{ flex: 1, paddingRight: 12 }} gap={4}>
            <Text variant="label" numberOfLines={2}>
              {title}
            </Text>
            <Text
              variant="caption"
              color="textSecondary"
              numberOfLines={1}
              testID={`queue-active-status-${id}`}>
              {statusLabel}
            </Text>
            {metaParts.length > 0 ? (
              <Text variant="caption" color="textSecondary" numberOfLines={1}>
                {metaParts.join(' · ')}
              </Text>
            ) : null}
            {progressMeta ? (
              <Text variant="caption" color="textSecondary" numberOfLines={1}>
                {progressMeta}
              </Text>
            ) : null}
            {runtime.pauseBlockedReason === 'SOURCE_NOT_RESUMABLE' ? (
              <Text
                variant="caption"
                color="textSecondary"
                numberOfLines={2}
                testID={`queue-active-pause-unsupported-${id}`}>
                {t('downloads.pauseUnsupported')}
              </Text>
            ) : null}
          </Box>
          <Box row gap={4} style={{ alignItems: 'center' }}>
            {runtime.canPause ? (
              <IconButton
                icon="pause"
                accessibilityLabel={t('downloads.pauseNamedA11y', { title })}
                onPress={handlePause}
                disabled={mutating}
                variant="ghost"
                testID={`queue-active-pause-${id}`}
              />
            ) : null}
            {runtime.canResume ? (
              <IconButton
                icon="play"
                accessibilityLabel={t('downloads.resumeNamedA11y', { title })}
                onPress={handleResume}
                disabled={mutating}
                variant="ghost"
                testID={`queue-active-resume-${id}`}
              />
            ) : null}
            {runtime.canCancel ? (
              <IconButton
                icon="close"
                accessibilityLabel={t('downloads.cancelNamedA11y', { title })}
                onPress={handleCancel}
                disabled={mutating}
                variant="ghost"
                testID={`queue-active-cancel-${id}`}
              />
            ) : null}
          </Box>
        </Box>
        <ProgressBar progress={progress / 100} />
      </Box>
    </Pressable>
  );
});
