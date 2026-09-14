import { memo, useCallback, useMemo } from 'react';
import { SectionList } from 'react-native';

import { Box } from '@/components/base/Box';
import { Text } from '@/components/base/Text';
import { EmptyState } from '@/components/common/EmptyState';
import { SafeAreaScreen } from '@/components/common/SafeAreaScreen';
import { ScreenHeader } from '@/components/headers/ScreenHeader';
import { useTheme } from '@/hooks/use-theme';
import { navigation } from '@/navigation';

import { QueueActiveRow } from './components/QueueActiveRow';
import { QueuePendingRow } from './components/QueuePendingRow';
import { useQueueScreen } from './hooks/useQueueScreen';
import { useDownloadsTokens } from './theme/downloads-tokens';

type QueueSection = {
  key: 'active' | 'pending';
  title: string;
  data: string[];
};

export const QueueScreen = memo(function QueueScreen() {
  const downloadsTokens = useDownloadsTokens();
  const theme = useTheme();
  const {
    snapshot,
    mutatingIds,
    formatWaitingReason,
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
        title: 'Active',
        data: snapshot.active.map((item) => item.downloadId),
      });
    }
    if (snapshot.pending.length > 0) {
      next.push({
        key: 'pending',
        title: 'Up Next',
        data: snapshot.pending.map((item) => item.downloadId),
      });
    }
    return next;
  }, [snapshot]);

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
        title="Queue"
        subtitle="Active and up next"
        showBack
        onBackPress={handleBack}
        testID="download-queue-header"
      />

      {empty ? (
        <Box px={downloadsTokens.spacing.screenX} py={32}>
          <EmptyState
            title="No downloads waiting"
            description="Active downloads and queued items will appear here."
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
                waitingLabel={formatWaitingReason(pending.waitingReason)}
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
