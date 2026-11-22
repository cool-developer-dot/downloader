import { memo, useCallback, useMemo, useState } from 'react';
import { View } from 'react-native';

import { Pressable } from '@/components/base/Pressable';
import type { ActionSheetItem } from '@/components/bottom-sheets/ActionSheet';
import { ActionSheetModal } from '@/components/bottom-sheets/ActionSheetModal';
import { ds, DsCard, DsIcon, DsIconButton, DsProgressBar, DsText, DsThumb } from '@/design';
import { showInFolderTarget } from '@/downloads/v2/save-location';
import { useExternalCopiesStore } from '@/downloads/v2/save-location-store';
import { showItemInFolder } from '@/downloads/v2/show-in-folder';
import { useRtl, useTranslation } from '@/localization';
import type { TranslationKey } from '@/localization/types';
import { navigation, routePaths } from '@/navigation';
import { useDownloadsStore } from '@/store/downloads';

import {
  buildMetaLine,
  buildProgressMeta,
  formatTransferSpeed,
  getStatusLabel,
  getSupportedActions,
  recordingLabelFor,
  waitingLabelFor,
  type DownloadCardAction,
} from '../utils/download-format';
import { useDownloadLinkMenuItems } from './DownloadLinkMenu';

export type DownloadCardProps = {
  id: string;
  onPress?: (id: string) => void;
  /** Always opens the details — with "Tap to pause or resume" on, a tap on an active row toggles it instead. */
  onLongPress?: (id: string) => void;
  onPause: (id: string) => void;
  onResume: (id: string) => void;
  onCancel: (id: string) => void;
  onRetry: (id: string) => void;
  onOpen: (id: string) => void;
  onShare: (id: string) => void;
  onRemove: (id: string) => void;
  testID?: string;
};

/** The design's download thumbnail is a little wider than the recent-item one (64 × 45 in frame 10). */
const THUMB_WIDTH = 64;

const ACTION_LABEL_KEYS: Record<DownloadCardAction, { label: TranslationKey; a11y: TranslationKey }> = {
  stop: { label: 'downloads.stop', a11y: 'downloads.primaryStop' },
  pause: { label: 'common.pause', a11y: 'downloads.primaryPause' },
  resume: { label: 'common.resume', a11y: 'downloads.primaryResume' },
  cancel: { label: 'common.cancel', a11y: 'downloads.primaryCancel' },
  retry: { label: 'common.retry', a11y: 'downloads.primaryRetry' },
  open: { label: 'common.open', a11y: 'downloads.primaryOpen' },
  share: { label: 'common.share', a11y: 'downloads.primaryShare' },
  remove: { label: 'common.remove', a11y: 'downloads.primaryRemove' },
};

const DESTRUCTIVE: ReadonlySet<DownloadCardAction> = new Set(['cancel', 'remove']);

/** The design's "ETA 01:12": minutes and seconds, hours in front when there are any. */
export function formatEtaClock(etaSeconds: number | null | undefined): string | null {
  if (etaSeconds == null || !Number.isFinite(etaSeconds) || etaSeconds <= 0) {
    return null;
  }
  const total = Math.ceil(etaSeconds);
  const hours = Math.floor(total / 3600);
  const minutes = Math.floor((total % 3600) / 60);
  const seconds = total % 60;
  const mm = String(minutes).padStart(2, '0');
  const ss = String(seconds).padStart(2, '0');
  return hours > 0 ? `${hours}:${mm}:${ss}` : `${mm}:${ss}`;
}

/** A tappable word of the row: grey on a finished row ("Play", "Share"), the accent for a failed row's "Try again". */
const InlineAction = memo(function InlineAction({
  label,
  onPress,
  disabled,
  accessibilityLabel,
  tone = 'plain',
  testID,
}: {
  label: string;
  onPress: () => void;
  disabled?: boolean;
  accessibilityLabel: string;
  tone?: 'plain' | 'accent';
  testID?: string;
}) {
  return (
    <Pressable
      onPress={onPress}
      disabled={disabled}
      accessibilityRole="button"
      accessibilityLabel={accessibilityLabel}
      hitSlop={{ top: 14, bottom: 14, left: 4, right: 4 }}
      testID={testID}
      style={{ minHeight: 20, justifyContent: 'center' }}>
      <DsText variant={tone === 'accent' ? 'rowValue' : 'rowSub'} color={tone === 'accent' ? 'primary' : undefined} numberOfLines={1}>
        {label}
      </DsText>
    </Pressable>
  );
});

/**
 * One download as the design's white card: thumbnail · title / meta · ⋮, then the 6 dp bar with "62% · Downloading"
 * and "ETA 01:12", or "✓ Completed" with "Play · Share · Show in folder" for a finished file. Subscribes to its own
 * row only, so progress ticks on one card never re-render its siblings.
 */
export const DownloadCard = memo(function DownloadCard({
  id,
  onPress,
  onLongPress,
  onPause,
  onResume,
  onCancel,
  onRetry,
  onOpen,
  onShare,
  onRemove,
  testID,
}: DownloadCardProps) {
  const rtl = useRtl();
  const { t } = useTranslation();
  const item = useDownloadsStore((state) => state.itemsById[id]);
  const transfer = useDownloadsStore((state) => state.transferById[id] ?? null);
  const mutating = useDownloadsStore((state) => Boolean(state.mutatingIds[id]));
  const copyRecord = useExternalCopiesStore((state) => state.records[id]);
  const linkItems = useDownloadLinkMenuItems(id);
  const [menuVisible, setMenuVisible] = useState(false);

  const handleOpenDetails = useCallback(() => onPress?.(id), [id, onPress]);
  const handleLongPress = useCallback(() => onLongPress?.(id), [id, onLongPress]);
  const handleOpen = useCallback(() => onOpen(id), [id, onOpen]);
  const handleShare = useCallback(() => onShare(id), [id, onShare]);
  const handleRetry = useCallback(() => onRetry(id), [id, onRetry]);
  const handleShowInFolder = useCallback(() => {
    void showItemInFolder(id);
  }, [id]);
  const openMenu = useCallback(() => setMenuVisible(true), []);
  const closeMenu = useCallback(() => setMenuVisible(false), []);

  const status = item?.status;
  const recording = status === 'DOWNLOADING' ? recordingLabelFor(transfer) : null;
  const actions = useMemo(
    () =>
      item
        ? getSupportedActions(item.status, item.sourceUrl, {
            localUri: transfer?.localUri ?? null,
            localState: transfer?.localState ?? null,
            executionState: transfer?.executionState ?? null,
            workerState: item.workerState ?? transfer?.workerState ?? null,
            supportsResume: transfer?.supportsResume ?? null,
            errorCode: item.errorCode ?? null,
            recording: recording != null,
          })
        : [],
    [item, recording, transfer],
  );

  const menuItems = useMemo<ActionSheetItem[]>(() => {
    const dispatch: Record<DownloadCardAction, () => void> = {
      stop: () => void useDownloadsStore.getState().stopRecording(id),
      pause: () => onPause(id),
      resume: () => onResume(id),
      cancel: () => onCancel(id),
      retry: () => onRetry(id),
      open: () => onOpen(id),
      share: () => onShare(id),
      remove: () => onRemove(id),
    };
    const items: ActionSheetItem[] = actions.map((action) => ({
      id: action,
      label: t(ACTION_LABEL_KEYS[action].label),
      destructive: DESTRUCTIVE.has(action),
      onPress: dispatch[action],
    }));
    items.push(...linkItems);
    // Design 45: the file actions screen for a finished file.
    items.push({
      id: 'file_actions',
      label: t('lightDownloadSettings.fileActions'),
      onPress: () => navigation.push({ pathname: routePaths.downloadsFileActions, params: { id } }),
    });
    if (onLongPress) {
      items.push({ id: 'details', label: t('lightDownloads.openDetails'), onPress: () => onLongPress(id) });
    }
    return items;
  }, [actions, id, linkItems, onCancel, onLongPress, onOpen, onPause, onRemove, onResume, onRetry, onShare, t]);

  if (!item) {
    return null;
  }

  const title = item.title?.trim() || item.fileName?.trim() || t('downloads.untitled');
  const metaLine = buildMetaLine(item, { hideSize: recording != null });
  const completed = item.status === 'COMPLETED';
  const canRetry = item.status === 'FAILED' && actions.includes('retry');
  const progressValue = Math.max(transfer?.progress ?? 0, item.progress ?? 0);
  const hasKnownTotal =
    (transfer?.totalBytes != null && transfer.totalBytes > 0) || Number(item.fileSize) > 0;
  const percent = Math.round(Math.min(100, Math.max(0, progressValue)));

  // "62% · Downloading" — the design's word for a running row; a held one says why it waits (F3), a recording its
  // length and size (F6).
  const waiting = recording ? null : waitingLabelFor(transfer);
  const stateLabel =
    recording ??
    waiting ??
    (item.status === 'DOWNLOADING' ? t('lightDownloads.statusDownloading') : getStatusLabel(item.status));
  const progressLine =
    recording || !hasKnownTotal ? stateLabel : t('lightDownloads.progressStatus', { percent, status: stateLabel });
  const eta = recording ? null : formatEtaClock(transfer?.etaSeconds);
  const trailingLine = eta ? t('lightDownloads.eta', { time: eta }) : recording ? null : formatTransferSpeed(transfer?.bytesPerSecond ?? null);
  const errorLine = item.status === 'FAILED' ? item.errorMessage?.trim() || null : null;

  const canOpenFile = actions.includes('open');
  const canShareFile = actions.includes('share');
  const folderTarget = completed ? showInFolderTarget(copyRecord) : null;
  const completedNote = completed && !canOpenFile ? buildProgressMeta(item, transfer) : null;

  const accessibilityParts = [
    title,
    completed ? getStatusLabel('COMPLETED') : progressLine,
    completed ? null : trailingLine,
    metaLine,
    errorLine,
  ].filter(Boolean);

  const inlineActions: { key: string; label: string; a11y: string; onPress: () => void }[] = completed
    ? [
        canOpenFile ? { key: 'play', label: t('common.play'), a11y: t('downloads.primaryOpen'), onPress: handleOpen } : null,
        canShareFile ? { key: 'share', label: t('common.share'), a11y: t('downloads.primaryShare'), onPress: handleShare } : null,
        folderTarget
          ? { key: 'folder', label: t('saveLocation.showInFolder'), a11y: t('saveLocation.showInFolderHint'), onPress: handleShowInFolder }
          : null,
      ].filter((action): action is NonNullable<typeof action> => action != null)
    : [];

  return (
    <DsCard testID={testID} style={{ marginBottom: 8 }}>
      <Pressable
        onPress={onPress ? handleOpenDetails : undefined}
        onLongPress={onLongPress ? handleLongPress : undefined}
        disabled={!onPress && !onLongPress}
        accessibilityRole={onPress ? 'button' : undefined}
        accessibilityLabel={accessibilityParts.join('. ')}
        accessibilityHint={onPress ? t('downloads.opensDetails') : undefined}
        style={{ margin: -ds.space.cardPad, padding: ds.space.cardPad }}>
        <View style={{ flexDirection: rtl.rowDirection, alignItems: 'flex-start', gap: ds.space.rowGap }}>
          <DsThumb
            uri={item.thumbnailUrl || null}
            kind={completed ? 'video' : 'transfer'}
            width={THUMB_WIDTH}
            testID={testID ? `${testID}-thumb` : undefined}
          />
          <View style={{ flex: 1, minWidth: 0, paddingEnd: 28 }}>
            <DsText variant="rowTitle" numberOfLines={2}>
              {title}
            </DsText>
            {metaLine ? (
              <DsText variant="rowSub" numberOfLines={1} style={{ marginTop: 1 }}>
                {metaLine}
              </DsText>
            ) : null}
          </View>
        </View>

        {completed ? null : (
          <View style={{ marginTop: 6 }}>
            <DsProgressBar
              progress={hasKnownTotal ? progressValue / 100 : 0}
              accessibilityLabel={progressLine}
              testID={testID ? `${testID}-progress` : undefined}
            />
            <View style={{ flexDirection: rtl.rowDirection, alignItems: 'center', gap: 8, marginTop: 4 }}>
              <DsText variant="rowSub" numberOfLines={1} style={{ flex: 1 }} testID={testID ? `${testID}-status` : undefined}>
                {progressLine}
              </DsText>
              {canRetry ? (
                // Design 46: a failed download is retried right from its card (also in the ⋮ menu).
                <InlineAction
                  label={t(ACTION_LABEL_KEYS.retry.label)}
                  accessibilityLabel={t(ACTION_LABEL_KEYS.retry.a11y)}
                  onPress={handleRetry}
                  disabled={mutating}
                  tone="accent"
                  testID={testID ? `${testID}-retry` : undefined}
                />
              ) : trailingLine ? (
                <DsText variant="rowSub" numberOfLines={1} importantForAccessibility="no" accessibilityElementsHidden>
                  {trailingLine}
                </DsText>
              ) : null}
            </View>
            {errorLine ? (
              <DsText variant="rowSub" color="error" numberOfLines={2} style={{ marginTop: 4 }}>
                {errorLine}
              </DsText>
            ) : null}
          </View>
        )}
      </Pressable>

      {completed ? (
        <View
          style={{ flexDirection: rtl.rowDirection, alignItems: 'center', gap: 6, marginTop: 2 }}
          accessibilityLabel={t('lightDownloads.completedActionsA11y')}>
          <DsIcon name="check" size={12} color="success" strokeWidth={2.2} />
          <DsText variant="rowSub" color="success" numberOfLines={1} style={{ flex: 1 }}>
            {getStatusLabel('COMPLETED')}
          </DsText>
          {inlineActions.length > 0 ? (
            <View style={{ flexDirection: rtl.rowDirection, alignItems: 'center', gap: 6 }}>
              {inlineActions.map((action, index) => (
                <View key={action.key} style={{ flexDirection: rtl.rowDirection, alignItems: 'center', gap: 6 }}>
                  {index > 0 ? (
                    <DsText variant="rowSub" importantForAccessibility="no" accessibilityElementsHidden>
                      ·
                    </DsText>
                  ) : null}
                  <InlineAction
                    label={action.label}
                    accessibilityLabel={action.a11y}
                    onPress={action.onPress}
                    disabled={mutating}
                    testID={testID ? `${testID}-${action.key}` : undefined}
                  />
                </View>
              ))}
            </View>
          ) : completedNote ? (
            <DsText variant="rowSub" numberOfLines={1}>
              {completedNote}
            </DsText>
          ) : null}
        </View>
      ) : null}

      <View style={{ position: 'absolute', top: 0, end: 0 }}>
        <DsIconButton
          variant="plain"
          icon="ellipsis-vertical"
          iconSize={18}
          onPress={openMenu}
          disabled={mutating || menuItems.length === 0}
          accessibilityLabel={t('lightDownloads.itemMenuA11y')}
          testID={testID ? `${testID}-menu` : undefined}
        />
      </View>

      <ActionSheetModal
        visible={menuVisible}
        onClose={closeMenu}
        title={t('lightDownloads.itemMenuTitle')}
        subtitle={title}
        actions={menuItems}
        testID={testID ? `${testID}-menu-sheet` : undefined}
      />
    </DsCard>
  );
});
