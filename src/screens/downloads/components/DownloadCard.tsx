import { Image } from 'expo-image';
import { memo, useCallback, useState } from 'react';

import { Box } from '@/components/base/Box';
import { Icon } from '@/components/base/Icon';
import { Pressable } from '@/components/base/Pressable';
import { Text } from '@/components/base/Text';
import { ProgressBar } from '@/components/common/ProgressBar';
import { useTranslation } from '@/localization';
import { useDownloadsStore } from '@/store/downloads';

import { useDownloadsTokens } from '../theme/downloads-tokens';
import {
  buildMetaLine,
  buildProgressMeta,
  getStatusLabel,
  getSupportedActions,
  resolveTransferRuntime,
  type DownloadCardAction,
} from '../utils/download-format';

export type DownloadCardProps = {
  id: string;
  onPress?: (id: string) => void;
  onPause: (id: string) => void;
  onResume: (id: string) => void;
  onCancel: (id: string) => void;
  onRetry: (id: string) => void;
  onOpen: (id: string) => void;
  onShare: (id: string) => void;
  onRemove: (id: string) => void;
  testID?: string;
};

type ActionButtonProps = {
  action: DownloadCardAction;
  disabled?: boolean;
  onPress: () => void;
  testID?: string;
};

const ACTION_ICONS: Record<
  DownloadCardAction,
  { icon: string; destructive?: boolean }
> = {
  pause: { icon: 'pause' },
  resume: { icon: 'play' },
  cancel: { icon: 'close', destructive: true },
  retry: { icon: 'refresh' },
  open: { icon: 'open-in-new' },
  share: { icon: 'share-variant' },
  remove: { icon: 'trash-can-outline', destructive: true },
};

const ACTION_LABEL_KEYS: Record<
  DownloadCardAction,
  { label: 'common.pause' | 'common.resume' | 'common.cancel' | 'common.retry' | 'common.open' | 'common.share' | 'common.remove'; a11y: 'downloads.primaryPause' | 'downloads.primaryResume' | 'downloads.primaryCancel' | 'downloads.primaryRetry' | 'downloads.primaryOpen' | 'downloads.primaryShare' | 'downloads.primaryRemove' }
> = {
  pause: { label: 'common.pause', a11y: 'downloads.primaryPause' },
  resume: { label: 'common.resume', a11y: 'downloads.primaryResume' },
  cancel: { label: 'common.cancel', a11y: 'downloads.primaryCancel' },
  retry: { label: 'common.retry', a11y: 'downloads.primaryRetry' },
  open: { label: 'common.open', a11y: 'downloads.primaryOpen' },
  share: { label: 'common.share', a11y: 'downloads.primaryShare' },
  remove: { label: 'common.remove', a11y: 'downloads.primaryRemove' },
};

const ActionButton = memo(function ActionButton({
  action,
  disabled,
  onPress,
  testID,
}: ActionButtonProps) {
  const downloadsTokens = useDownloadsTokens();
  const { t } = useTranslation();
  const config = ACTION_ICONS[action];
  const labels = ACTION_LABEL_KEYS[action];
  const showLabel = action === 'resume' || action === 'retry';
  const size = showLabel
    ? Math.max(downloadsTokens.actionButtonSize, downloadsTokens.touchTarget)
    : downloadsTokens.actionButtonSize;

  return (
    <Pressable
      onPress={onPress}
      disabled={disabled}
      accessibilityRole="button"
      accessibilityLabel={t(labels.a11y)}
      accessibilityState={{ disabled: Boolean(disabled) }}
      hitSlop={8}
      testID={testID}
      style={({ pressed }) => ({
        minWidth: size,
        minHeight: size,
        paddingHorizontal: showLabel ? 10 : 0,
        borderRadius: downloadsTokens.radius.action,
        alignItems: 'center',
        justifyContent: 'center',
        gap: showLabel ? 2 : 0,
        opacity: disabled ? 0.5 : 1,
        backgroundColor: config.destructive
          ? pressed
            ? downloadsTokens.destructiveButtonPressed
            : downloadsTokens.destructiveButtonBg
          : pressed
            ? downloadsTokens.actionButtonPressed
            : downloadsTokens.actionButtonBg,
        transform: [{ scale: pressed && !disabled ? 0.94 : 1 }],
      })}>
      <Icon
        name={config.icon}
        size="sm"
        color={config.destructive ? 'error' : 'primary'}
      />
      {showLabel ? (
        <Text
          variant="caption"
          color="primary"
          style={{ fontWeight: '600', fontSize: 11, lineHeight: 14 }}>
          {t(labels.label)}
        </Text>
      ) : null}
    </Pressable>
  );
});

/**
 * Subscribes to a single download by id so progress ticks on one card
 * do not re-render sibling cards.
 */
export const DownloadCard = memo(function DownloadCard({
  id,
  onPress,
  onPause,
  onResume,
  onCancel,
  onRetry,
  onOpen,
  onShare,
  onRemove,
  testID,
}: DownloadCardProps) {
  const downloadsTokens = useDownloadsTokens();
  const { t } = useTranslation();
  const item = useDownloadsStore((state) => state.itemsById[id]);
  const transfer = useDownloadsStore((state) => state.transferById[id] ?? null);
  const mutating = useDownloadsStore((state) => Boolean(state.mutatingIds[id]));
  const [thumbFailed, setThumbFailed] = useState(false);

  const handleOpenDetails = useCallback(() => onPress?.(id), [id, onPress]);
  const handlePause = useCallback(() => onPause(id), [id, onPause]);
  const handleResume = useCallback(() => onResume(id), [id, onResume]);
  const handleCancel = useCallback(() => onCancel(id), [id, onCancel]);
  const handleRetry = useCallback(() => onRetry(id), [id, onRetry]);
  const handleOpen = useCallback(() => onOpen(id), [id, onOpen]);
  const handleShare = useCallback(() => onShare(id), [id, onShare]);
  const handleRemove = useCallback(() => onRemove(id), [id, onRemove]);

  if (!item) {
    return null;
  }

  const title = item.title?.trim() || item.fileName?.trim() || 'Untitled download';
  const metaLine = buildMetaLine(item);
  const progressMeta = buildProgressMeta(item, transfer);
  const statusLabel = getStatusLabel(item.status);
  const statusColors = downloadsTokens.status[item.status];
  const runtimeOptions = {
    localUri: transfer?.localUri ?? null,
    localState: transfer?.localState ?? null,
    executionState: transfer?.executionState ?? null,
    workerState: item.workerState ?? transfer?.workerState ?? null,
    supportsResume: transfer?.supportsResume ?? null,
    errorCode: item.errorCode ?? null,
  };
  const actions = getSupportedActions(item.status, item.sourceUrl, runtimeOptions);
  const pauseBlocked =
    resolveTransferRuntime(item.status, runtimeOptions).pauseBlockedReason ===
    'SOURCE_NOT_RESUMABLE';
  const progressValue = Math.max(
    transfer?.progress ?? 0,
    item.progress ?? 0,
  );
  const hasKnownTotal =
    (transfer?.totalBytes != null && transfer.totalBytes > 0) ||
    Number(item.fileSize) > 0 ||
    item.status === 'COMPLETED';
  const showProgress =
    item.status === 'DOWNLOADING' ||
    item.status === 'PAUSED' ||
    (item.status === 'QUEUED' && progressValue > 0);
  const showPercentLabel = hasKnownTotal && item.status !== 'COMPLETED';
  const showCompletedBadge = item.status === 'COMPLETED';

  const accessibilityParts = [
    title,
    statusLabel,
    metaLine,
    // Progress percent lives on ProgressBar accessibilityValue — avoid
    // re-announcing every ~250ms tick via this parent label.
    item.status === 'COMPLETED' ? '100 percent complete' : null,
    item.status === 'FAILED' && item.errorMessage
      ? item.errorMessage
      : null,
  ].filter(Boolean);

  const dispatchAction = (action: DownloadCardAction) => {
    switch (action) {
      case 'pause':
        handlePause();
        break;
      case 'resume':
        handleResume();
        break;
      case 'cancel':
        handleCancel();
        break;
      case 'retry':
        handleRetry();
        break;
      case 'open':
        handleOpen();
        break;
      case 'share':
        handleShare();
        break;
      case 'remove':
        handleRemove();
        break;
    }
  };

  return (
    <Box
      testID={testID}
      row
      px={downloadsTokens.spacing.screenX}
      py={downloadsTokens.spacing.rowY}
      style={{ alignItems: 'flex-start', gap: 4 }}>
      <Pressable
        onPress={onPress ? handleOpenDetails : undefined}
        disabled={!onPress}
        accessibilityRole={onPress ? 'button' : undefined}
        accessibilityLabel={accessibilityParts.join('. ')}
        accessibilityHint={onPress ? t('downloads.opensDetails') : undefined}
        style={({ pressed }) => ({
          flex: 1,
          minWidth: 0,
          borderRadius: downloadsTokens.radius.card,
          backgroundColor:
            pressed && onPress ? downloadsTokens.rowPressed : 'transparent',
          paddingVertical: 2,
        })}>
        <Box
          row
          gap={12}
          style={{
            alignItems: 'flex-start',
            minWidth: 0,
          }}>
          <Box
            style={{
              width: downloadsTokens.thumbnailSize,
              height: downloadsTokens.thumbnailSize,
              borderRadius: downloadsTokens.radius.thumbnail,
              backgroundColor: downloadsTokens.thumbnailBg,
              overflow: 'hidden',
              alignItems: 'center',
              justifyContent: 'center',
            }}
            accessibilityIgnoresInvertColors>
            {item.thumbnailUrl && !thumbFailed ? (
              <Image
                source={{ uri: item.thumbnailUrl }}
                style={{ width: '100%', height: '100%' }}
                contentFit="cover"
                recyclingKey={id}
                cachePolicy="disk"
                onError={() => setThumbFailed(true)}
                accessibilityIgnoresInvertColors
              />
            ) : (
              <Icon name="video-outline" size="md" color="secondary" />
            )}
          </Box>

          <Box flex={1} gap={6} style={{ minWidth: 0 }}>
            <Text variant="body" numberOfLines={2}>
              {title}
            </Text>

            {metaLine ? (
              <Text variant="caption" color="textSecondary" numberOfLines={1}>
                {metaLine}
              </Text>
            ) : null}

            {item.fileName && item.fileName !== title ? (
              <Text variant="caption" color="textSecondary" numberOfLines={1}>
                {item.fileName}
              </Text>
            ) : null}

            {showProgress ? (
              <Box gap={4}>
                <ProgressBar
                  progress={Math.min(1, Math.max(0, progressValue / 100))}
                  testID={testID ? `${testID}-progress` : undefined}
                />
                <Box row style={{ justifyContent: 'space-between', gap: 8 }}>
                  <Box flex={1} style={{ minWidth: 0 }}>
                    {progressMeta ? (
                      <Text
                        variant="caption"
                        color="textSecondary"
                        numberOfLines={1}>
                        {progressMeta}
                      </Text>
                    ) : null}
                  </Box>
                  {showPercentLabel ? (
                    <Text
                      variant="caption"
                      color="textSecondary"
                      importantForAccessibility="no"
                      accessibilityElementsHidden>
                      {`${Math.round(progressValue)}%`}
                    </Text>
                  ) : null}
                </Box>
              </Box>
            ) : null}

            {showCompletedBadge && progressMeta ? (
              <Text variant="caption" color="textSecondary" numberOfLines={1}>
                {progressMeta}
              </Text>
            ) : null}

            {pauseBlocked ? (
              <Text
                variant="caption"
                color="textSecondary"
                numberOfLines={2}
                testID={testID ? `${testID}-pause-unsupported` : undefined}>
                {t('downloads.pauseUnsupported')}
              </Text>
            ) : null}

            {item.status === 'FAILED' && item.errorMessage ? (
              <Text variant="caption" color="error" numberOfLines={2}>
                {item.errorMessage}
              </Text>
            ) : null}

            <Box
              px={10}
              py={4}
              style={{
                alignSelf: 'flex-start',
                borderRadius: downloadsTokens.radius.badge,
                backgroundColor: statusColors.bg,
              }}
              accessibilityRole="text"
              accessibilityLabel={statusLabel}>
              <Text
                variant="caption"
                style={{
                  color: statusColors.fg,
                  fontWeight: '600',
                  letterSpacing: 0.3,
                  textTransform: 'uppercase',
                }}>
                {statusLabel}
              </Text>
            </Box>
          </Box>
        </Box>
      </Pressable>

      <Box
        gap={8}
        style={{ alignItems: 'center', paddingTop: 4 }}
        accessibilityLabel={t('downloads.actionsA11y')}>
        {actions.map((action) => (
          <ActionButton
            key={action}
            action={action}
            disabled={mutating}
            onPress={() => dispatchAction(action)}
            testID={testID ? `${testID}-${action}` : undefined}
          />
        ))}
      </Box>
    </Box>
  );
});
