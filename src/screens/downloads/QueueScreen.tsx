import { memo, useCallback, useMemo } from 'react';
import { SectionList } from 'react-native';

import { Box } from '@/components/base/Box';
import { Text } from '@/components/base/Text';
import { EmptyState } from '@/components/common/EmptyState';
import { SafeAreaScreen } from '@/components/common/SafeAreaScreen';
import { ScreenHeader } from '@/components/headers/ScreenHeader';
import type { QueueWaitingReason } from '@/downloads/scheduler';
import { useTheme } from '@/hooks/use-theme';
import { useTranslation } from '@/localization';
import type { TranslationKey } from '@/localization/types';
import { navigation } from '@/navigation';

import { QueueActiveRow } from './components/QueueActiveRow';
import { QueuePendingRow } from './components/QueuePendingRow';
import { useQueueScreen } from './hooks/useQueueScreen';
import { useDownloadsTokens } from './theme/downloads-tokens';

/** The waiting reasons, in the app's language (the v1 scheduler's own copy stays English for its logs). */
const WAITING_REASON_KEYS: Record<QueueWaitingReason, TranslationKey> = {
  CAPACITY: 'downloads.queued',
  WAITING_FOR_WIFI: 'downloads.waitingWifi',
  OFFLINE: 'downloads.waitingNetwork',
  RETRY_DELAY: 'downloads.retrying',
  RECOVERY_PENDING: 'downloads.preparing',
};

type QueueSection = {
  key: 'active' | 'pending';
  title: string;
  data: string[];
};

export const QueueScreen = memo(function QueueScreen() {
  const downloadsTokens = useDownloadsTokens();
  const theme = useTheme();
  const { t } = useTranslation();
  const {
    snapshot,
    mutatingIds,
    openDetails,
    onCancel,
    onPause,
    onResume,
  } = useQueueScreen();

  const sections = useMemo<QueueSection[]>(() => {
    const next: QueueSection[] = [];
    if (snapshot.active.length > 0) {
      next.push({
        key: 'active',
        title: t('queueScreen.active'),
        data: snapshot.active.map((item) => item.downloadId),
      });
    }
    if (snapshot.pending.length > 0) {
      next.push({
        key: 'pending',
        title: t('queueScreen.upNext'),
        data: snapshot.pending.map((item) => item.downloadId),
      });
    }
    return next;
  }, [snapshot, t]);

  const pendingById = useMemo(() => {
    const map = new Map(
      snapshot.pending.map((item) => [item.downloadId, item] as const),
    );
    return map;
  }, [snapshot.pending]);

  const handleBack = useCallback(() => {
    navigation.back();
  }, []);

  const handleCancel = useCallback(
    (id: string) => {
      void onCancel(id);
    },
    [onCancel],
  );

  const handlePause = useCallback(
    (id: string) => {
      void onPause(id);
    },
    [onPause],
  );

  const handleResume = useCallback(
    (id: string) => {
      void onResume(id);
    },
    [onResume],
  );

  const empty = sections.length === 0;

  return (
    <SafeAreaScreen
      testID="download-queue-screen"
      padded={false}
      edges={['top', 'left', 'right', 'bottom']}
      style={{ backgroundColor: theme.colors.background }}>
      <ScreenHeader
        title={t('queueScreen.title')}
        subtitle={t('queueScreen.subtitle')}
        showBack
        onBackPress={handleBack}
        testID="download-queue-header"
      />

      {empty ? (
        <Box px={downloadsTokens.spacing.screenX} py={32}>
          <EmptyState
            title={t('queueScreen.emptyTitle')}
            description={t('queueScreen.emptyDescription')}
            testID="download-queue-empty"
          />
        </Box>
      ) : (
        <SectionList
          sections={sections}
          keyExtractor={(id) => id}
          stickySectionHeadersEnabled={false}
          renderSectionHeader={({ section }) => (
            <Box
              px={downloadsTokens.spacing.screenX}
              pt={16}
              pb={8}
              style={{ backgroundColor: theme.colors.background }}>
              <Text
                variant="label"
                color="textSecondary"
                accessibilityRole="header"
                style={{ letterSpacing: 0.5 }}>
                {section.title}
              </Text>
            </Box>
          )}
          renderItem={({ item: id, section }) => {
            if (section.key === 'active') {
              return (
                <QueueActiveRow
                  id={id}
                  onPress={openDetails}
                  onPause={handlePause}
                  onResume={handleResume}
                  onCancel={handleCancel}
                  mutating={Boolean(mutatingIds[id])}
                />
              );
            }
            const pending = pendingById.get(id);
            if (!pending) {
              return null;
            }
            return (
              <QueuePendingRow
                id={id}
                position={pending.position}
                waitingReason={pending.waitingReason}
                waitingLabel={t(WAITING_REASON_KEYS[pending.waitingReason])}
                onPress={openDetails}
                onCancel={handleCancel}
                mutating={Boolean(mutatingIds[id])}
              />
            );
          }}
          contentContainerStyle={{ paddingBottom: 32 }}
          testID="download-queue-list"
        />
      )}
    </SafeAreaScreen>
  );
});
