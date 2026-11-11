import { useFocusEffect } from 'expo-router';
import { memo, useCallback, useEffect, useMemo, useState } from 'react';
import { AccessibilityInfo, SectionList, type SectionListRenderItem } from 'react-native';

import type { DownloadQueue } from '@modules/vidorax-media/src/VidoraMedia.types';

import { Box } from '@/components/base/Box';
import { Text } from '@/components/base/Text';
import type { ActionSheetItem } from '@/components/bottom-sheets/ActionSheet';
import { ActionSheetModal } from '@/components/bottom-sheets/ActionSheetModal';
import { Button } from '@/components/buttons/Button';
import { IconButton } from '@/components/buttons/IconButton';
import { Badge } from '@/components/common/Badge';
import { ConfirmModal } from '@/components/modals/ConfirmModal';
import {
  canAddQueue,
  canMove,
  canMoveQueue,
  groupByQueue,
  MAIN_QUEUE_ID,
  MAX_QUEUES,
  newQueueId,
  withHeld,
  withNewQueue,
  withoutQueue,
  withQueueMoved,
  withRenamedQueue,
  type ReorderDirection,
} from '@/downloads/v2/queue-order';
import {
  moveDownload,
  moveDownloadsToQueue,
  refreshQueueState,
  saveQueues,
  setReorderMode,
  useQueueOrderStore,
} from '@/downloads/v2/queue-order-store';
import { useTranslation } from '@/localization';
import type { TranslationKey } from '@/localization/types';
import { useDownloadsStore } from '@/store/downloads';

import { useDownloadsTokens } from '../theme/downloads-tokens';
import { QueueNameModal } from './QueueNameModal';

type QueueSection = { key: string; queue: DownloadQueue; data: string[] };

const MOVES: { direction: ReorderDirection; icon: string; a11y: TranslationKey }[] = [
  { direction: 'top', icon: 'arrow-collapse-up', a11y: 'queueOrder.moveTopA11y' },
  { direction: 'up', icon: 'arrow-up', a11y: 'queueOrder.moveUpA11y' },
  { direction: 'down', icon: 'arrow-down', a11y: 'queueOrder.moveDownA11y' },
  { direction: 'bottom', icon: 'arrow-collapse-down', a11y: 'queueOrder.moveBottomA11y' },
];

/**
 * H4: the Downloads tab's Reorder mode. Queued and paused downloads, queue by queue in the order they start, each with
 * buttons to move it up, down, to the top or to the bottom, or to another queue; queues can be added, renamed, held,
 * resumed, moved and deleted (their downloads go back to Main). Everything is saved by the engine at once.
 */
export const QueueReorderPanel = memo(function QueueReorderPanel() {
  const { t } = useTranslation();
  const tokens = useDownloadsTokens();
  const queueState = useQueueOrderStore((s) => s.queueState);
  const busy = useQueueOrderStore((s) => s.busy);
  const failed = useQueueOrderStore((s) => s.failed);
  const engineRows = useDownloadsStore((s) => s.engineRowsById);
  const [nameTarget, setNameTarget] = useState<DownloadQueue | 'new' | null>(null);
  const [optionsFor, setOptionsFor] = useState<DownloadQueue | null>(null);
  const [deleteTarget, setDeleteTarget] = useState<DownloadQueue | null>(null);
  const [moveTarget, setMoveTarget] = useState<string | null>(null);

  const downloads = useMemo(
    () =>
      Object.values(engineRows)
        .filter((row) => row.status === 'QUEUED' || row.status === 'PAUSED')
        .map((row) => ({ id: row.id, createdAt: row.createdAt })),
    [engineRows],
  );
  const downloadKey = useMemo(() => downloads.map((download) => download.id).join(','), [downloads]);
  const groups = useMemo(() => groupByQueue(queueState, downloads), [downloads, queueState]);
  const sections = useMemo<QueueSection[]>(
    () => groups.map((group) => ({ key: group.queue.id, queue: group.queue, data: group.ids })),
    [groups],
  );
  const queues = queueState.queues;

  // A download that starts, finishes or is added changes who waits: the engine's view is read again.
  useEffect(() => {
    void refreshQueueState();
  }, [downloadKey]);

  // Leaving the Downloads tab leaves Reorder mode.
  useFocusEffect(
    useCallback(() => {
      return () => setReorderMode(false);
    }, []),
  );

  const queueName = useCallback(
    (queue: DownloadQueue) => (queue.id === MAIN_QUEUE_ID ? t('queueOrder.main') : queue.name),
    [t],
  );

  const move = useCallback(
    (id: string, direction: ReorderDirection) => {
      void moveDownload(groups, id, direction).then((moved) => {
        if (moved) {
          AccessibilityInfo.announceForAccessibility(t('queueOrder.moved'));
        }
      });
    },
    [groups, t],
  );

  const saveName = useCallback(
    (name: string) => {
      const target = nameTarget;
      if (!target) {
        return;
      }
      const next =
        target === 'new' ? withNewQueue(queues, newQueueId(queues), name) : withRenamedQueue(queues, target.id, name);
      void saveQueues(next).then((saved) => {
        if (saved) {
          setNameTarget(null);
        }
      });
    },
    [nameTarget, queues],
  );

  const toggleHeld = useCallback(
    (queue: DownloadQueue) => {
      void saveQueues(withHeld(queues, queue.id, !queue.held)).then((saved) => {
        if (saved) {
          AccessibilityInfo.announceForAccessibility(
            queue.held ? t('queueOrder.resumedA11y', { name: queueName(queue) }) : t('queueOrder.heldA11y', { name: queueName(queue) }),
          );
        }
      });
    },
    [queueName, queues, t],
  );

  const confirmDelete = useCallback(() => {
    const target = deleteTarget;
    if (!target) {
      return;
    }
    void saveQueues(withoutQueue(queues, target.id)).then(() => setDeleteTarget(null));
  }, [deleteTarget, queues]);

  const optionActions = useMemo<ActionSheetItem[]>(() => {
    const queue = optionsFor;
    if (!queue) {
      return [];
    }
    const close = (then: () => void) => () => {
      setOptionsFor(null);
      then();
    };
    const actions: ActionSheetItem[] = [];
    if (canMoveQueue(queues, queue.id, 'up')) {
      actions.push({
        id: 'queue-up',
        label: t('queueOrder.moveQueueUp'),
        icon: 'arrow-up',
        onPress: close(() => void saveQueues(withQueueMoved(queues, queue.id, 'up'))),
      });
    }
    if (canMoveQueue(queues, queue.id, 'down')) {
      actions.push({
        id: 'queue-down',
        label: t('queueOrder.moveQueueDown'),
        icon: 'arrow-down',
        onPress: close(() => void saveQueues(withQueueMoved(queues, queue.id, 'down'))),
      });
    }
    if (queue.id !== MAIN_QUEUE_ID) {
      actions.push(
        { id: 'queue-rename', label: t('queueOrder.rename'), icon: 'pencil-outline', onPress: close(() => setNameTarget(queue)) },
        {
          id: 'queue-delete',
          label: t('queueOrder.delete'),
          icon: 'trash-can-outline',
          destructive: true,
          onPress: close(() => setDeleteTarget(queue)),
        },
      );
    }
    return actions;
  }, [optionsFor, queues, t]);

  const moveActions = useMemo<ActionSheetItem[]>(() => {
    const id = moveTarget;
    if (!id) {
      return [];
    }
    const current = queueState.assignments[id] ?? MAIN_QUEUE_ID;
    return queues
      .filter((queue) => queue.id !== current)
      .map((queue) => ({
        id: `move-to-${queue.id}`,
        label: queue.held ? `${queueName(queue)} · ${t('queueOrder.held')}` : queueName(queue),
        icon: queue.held ? 'pause-circle-outline' : 'playlist-play',
        onPress: () => {
          setMoveTarget(null);
          void moveDownloadsToQueue([id], queue.id);
        },
      }));
  }, [moveTarget, queueName, queueState.assignments, queues, t]);

  const renderItem: SectionListRenderItem<string, QueueSection> = useCallback(
    ({ item, section }) => {
      const row = engineRows[item];
      const title = row?.title || t('queueOrder.untitled');
      const ids = section.data;
      return (
        <Box
          row
          rtlRow
          center
          gap={4}
          px={tokens.spacing.screenX}
          py={6}
          testID={`queue-reorder-row-${item}`}>
          <Box flex={1} style={{ minWidth: 0 }}>
            <Text variant="body" numberOfLines={1}>
              {title}
            </Text>
            <Text variant="caption" color="textSecondary" numberOfLines={1}>
              {row?.status === 'PAUSED' ? t('downloads.statusPaused') : t('downloads.statusQueued')}
            </Text>
          </Box>
          {MOVES.map((entry) => (
            <IconButton
              key={entry.direction}
              icon={entry.icon}
              size="small"
              disabled={busy || !canMove(ids, item, entry.direction)}
              onPress={() => move(item, entry.direction)}
              accessibilityLabel={t(entry.a11y, { title })}
              testID={`queue-reorder-${entry.direction}-${item}`}
            />
          ))}
          {queues.length > 1 ? (
            <IconButton
              icon="swap-horizontal"
              size="small"
              disabled={busy}
              onPress={() => setMoveTarget(item)}
              accessibilityLabel={t('queueOrder.moveToQueueA11y', { title })}
              testID={`queue-reorder-move-to-${item}`}
            />
          ) : null}
        </Box>
      );
    },
    [busy, engineRows, move, queues.length, t, tokens.spacing.screenX],
  );

  const renderSectionHeader = useCallback(
    ({ section }: { section: QueueSection }) => {
      const { queue } = section;
      const name = queueName(queue);
      return (
        <Box
          row
          rtlRow
          center
          gap={8}
          px={tokens.spacing.screenX}
          style={{ paddingTop: 14, paddingBottom: 4, backgroundColor: tokens.background }}
          testID={`queue-reorder-queue-${queue.id}`}>
          <Box flex={1} row rtlRow center gap={8} style={{ minWidth: 0 }}>
            <Text variant="label" color="textSecondary" numberOfLines={1} accessibilityRole="header">
              {`${name} · ${section.data.length}`}
            </Text>
            {queue.held ? <Badge label={t('queueOrder.held')} variant="warning" /> : null}
          </Box>
          {queue.id !== MAIN_QUEUE_ID ? (
            <IconButton
              icon={queue.held ? 'play' : 'pause'}
              size="small"
              disabled={busy}
              onPress={() => toggleHeld(queue)}
              accessibilityLabel={
                queue.held ? t('queueOrder.resumeA11y', { name }) : t('queueOrder.holdA11y', { name })
              }
              testID={`queue-reorder-hold-${queue.id}`}
            />
          ) : null}
          {queues.length > 1 ? (
            <IconButton
              icon="dots-vertical"
              size="small"
              disabled={busy}
              onPress={() => setOptionsFor(queue)}
              accessibilityLabel={t('queueOrder.optionsA11y', { name })}
              testID={`queue-reorder-options-${queue.id}`}
            />
          ) : null}
        </Box>
      );
    },
    [busy, queueName, queues.length, t, toggleHeld, tokens.background, tokens.spacing.screenX],
  );

  const renderSectionFooter = useCallback(
    ({ section }: { section: QueueSection }) =>
      section.data.length === 0 ? (
        <Box px={tokens.spacing.screenX} py={6}>
          <Text variant="caption" color="textSecondary">
            {section.queue.held ? t('queueOrder.emptyHeld') : t('queueOrder.empty')}
          </Text>
        </Box>
      ) : null,
    [t, tokens.spacing.screenX],
  );

  const keyExtractor = useCallback((id: string) => id, []);
  const nameQueue = nameTarget === 'new' ? null : nameTarget;
  const contentStyle = useMemo(() => ({ flexGrow: 1, paddingBottom: 24 }), []);

  return (
    <Box flex={1} testID="downloads-queue-reorder">
      <Box px={tokens.spacing.screenX} pb={4} gap={4}>
        <Box row rtlRow center gap={8}>
          <Box flex={1}>
            <Text variant="title" accessibilityRole="header">
              {t('queueOrder.title')}
            </Text>
          </Box>
          <Button
            title={t('queueOrder.newQueue')}
            variant="outline"
            size="small"
            leftIcon="playlist-plus"
            disabled={busy || !canAddQueue(queues)}
            onPress={() => setNameTarget('new')}
            accessibilityHint={canAddQueue(queues) ? undefined : t('queueOrder.tooMany', { max: String(MAX_QUEUES) })}
            testID="queue-reorder-new-queue"
          />
          <Button
            title={t('common.done')}
            size="small"
            onPress={() => setReorderMode(false)}
            testID="queue-reorder-done"
          />
        </Box>
        <Text variant="caption" color="textSecondary">
          {t('queueOrder.hint')}
        </Text>
        {failed ? (
          <Text variant="caption" color="error" accessibilityLiveRegion="polite">
            {t('queueOrder.failed')}
          </Text>
        ) : null}
      </Box>

      <SectionList
        sections={sections}
        keyExtractor={keyExtractor}
        renderItem={renderItem}
        renderSectionHeader={renderSectionHeader}
        renderSectionFooter={renderSectionFooter}
        stickySectionHeadersEnabled={false}
        contentContainerStyle={contentStyle}
        keyboardShouldPersistTaps="handled"
        accessibilityRole="list"
        testID="queue-reorder-list"
      />

      <QueueNameModal
        visible={nameTarget !== null}
        queue={nameQueue}
        queues={queues}
        saving={busy}
        onSave={saveName}
        onClose={() => setNameTarget(null)}
      />
      <ActionSheetModal
        visible={optionsFor !== null}
        onClose={() => setOptionsFor(null)}
        title={optionsFor ? queueName(optionsFor) : undefined}
        actions={optionActions}
        testID="queue-reorder-options-sheet"
      />
      <ActionSheetModal
        visible={moveTarget !== null}
        onClose={() => setMoveTarget(null)}
        title={t('queueOrder.moveToQueue')}
        actions={moveActions}
        testID="queue-reorder-move-sheet"
      />
      <ConfirmModal
        visible={deleteTarget !== null}
        variant="delete"
        title={t('queueOrder.deleteTitle', { name: deleteTarget ? queueName(deleteTarget) : '' })}
        message={t('queueOrder.deleteMessage')}
        confirmLabel={t('queueOrder.delete')}
        cancelLabel={t('common.cancel')}
        loading={busy}
        onConfirm={confirmDelete}
        onCancel={() => setDeleteTarget(null)}
        testID="queue-reorder-delete-confirm"
      />
    </Box>
  );
});
