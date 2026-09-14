import { memo, useCallback } from 'react';

import { Box } from '@/components/base/Box';
import { Pressable } from '@/components/base/Pressable';
import { Text } from '@/components/base/Text';
import { IconButton } from '@/components/buttons/IconButton';
import type { QueueWaitingReason } from '@/downloads/scheduler';
import { useTranslation } from '@/localization';
import { useDownloadsStore } from '@/store/downloads';

import { useDownloadsTokens } from '../theme/downloads-tokens';
import {
  formatDownloadFileSize,
  formatPlatform,
  formatSourceHost,
} from '../utils/download-format';

export type QueuePendingRowProps = {
  id: string;
  position: number;
  waitingReason: QueueWaitingReason;
  waitingLabel: string;
  onPress: (id: string) => void;
  onCancel: (id: string) => void;
  mutating?: boolean;
};

export const QueuePendingRow = memo(function QueuePendingRow({
  id,
  position,
  waitingReason,
  waitingLabel,
  onPress,
  onCancel,
  mutating = false,
}: QueuePendingRowProps) {
  const downloadsTokens = useDownloadsTokens();
  const { t } = useTranslation();
  const item = useDownloadsStore((s) => s.itemsById[id] ?? null);

  const handlePress = useCallback(() => onPress(id), [id, onPress]);
  const handleCancel = useCallback(() => onCancel(id), [id, onCancel]);

  if (!item) {
    return null;
  }

  const title = item.title?.trim() || item.fileName?.trim() || t('downloads.untitled');
  const quality = item.quality?.trim() || null;
  const size = formatDownloadFileSize(item.fileSize);
  const source =
    formatPlatform(item.platform) || formatSourceHost(item.sourceUrl) || null;
  const metaParts = [quality, size, source].filter(Boolean);

  const a11y = [
    title,
    t('downloads.queuePositionA11y', { position }),
    waitingLabel,
    quality,
  ]
    .filter(Boolean)
    .join(', ');

  return (
    <Pressable
      onPress={handlePress}
      accessibilityRole="button"
      accessibilityLabel={a11y}
      testID={`queue-pending-${id}`}
      style={{
        minHeight: 64,
        paddingVertical: 12,
        paddingHorizontal: downloadsTokens.spacing.screenX,
        borderBottomWidth: 1,
        borderBottomColor: downloadsTokens.cardBorder,
      }}>
      <Box row gap={12} style={{ alignItems: 'center' }}>
        <Box
          style={{
            width: 28,
            height: 28,
            borderRadius: 14,
            alignItems: 'center',
            justifyContent: 'center',
            backgroundColor: downloadsTokens.status.QUEUED.bg,
          }}>
          <Text variant="caption" color="textSecondary">
            {position}
          </Text>
        </Box>
        <Box style={{ flex: 1 }} gap={4}>
          <Text variant="label" numberOfLines={2}>
            {title}
          </Text>
          {metaParts.length > 0 ? (
            <Text variant="caption" color="textSecondary" numberOfLines={1}>
              {metaParts.join(' · ')}
            </Text>
          ) : null}
          <Text
            variant="caption"
            color="textSecondary"
            accessibilityLabel={waitingLabel}
            testID={`queue-pending-reason-${waitingReason}-${id}`}>
            {waitingLabel}
          </Text>
        </Box>
        <IconButton
          icon="close"
          accessibilityLabel={t('downloads.cancelNamedA11y', { title })}
          onPress={handleCancel}
          disabled={mutating}
          variant="ghost"
          testID={`queue-pending-cancel-${id}`}
        />
      </Box>
    </Pressable>
  );
});
