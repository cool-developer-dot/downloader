import { memo, useCallback, useEffect, useState } from 'react';
import { AccessibilityInfo, Platform, ToastAndroid, View } from 'react-native';

import { ActionSheetModal } from '@/components/bottom-sheets/ActionSheetModal';
import type { ActionSheetItem } from '@/components/bottom-sheets/ActionSheet';
import { DsCard, DsIconButton, DsSectionLabel, DsText, DsThumb } from '@/design';
import { completedActionErrorMessageKey } from '@/downloads/completed-file/action-errors';
import { showInFolderTarget } from '@/downloads/v2/save-location';
import { useExternalCopiesStore } from '@/downloads/v2/save-location-store';
import { showItemInFolder } from '@/downloads/v2/show-in-folder';
import { libraryFormatLabel } from '@/library/format-label';
import { translate, useTranslation, type TranslationKey } from '@/localization';
import { downloadDetailsPath, navigation } from '@/navigation';
import { extractMediaType, formatDownloadFileSize } from '@/screens/downloads/utils/download-format';
import { useDownloadsStore, type DownloadItem, type DownloadsStore } from '@/store/downloads';

function finishedAt(item: DownloadItem): number {
  const time = Date.parse(item.downloadedAt ?? item.updatedAt ?? '');
  return Number.isFinite(time) ? time : 0;
}

/** The id of the most recently finished download (v1 catalog rows and v2 engine rows alike), or null. */
export function selectLatestCompletedId(state: DownloadsStore): string | null {
  let best: DownloadItem | null = null;
  const consider = (item: DownloadItem | undefined) => {
    if (!item || item.status !== 'COMPLETED' || state.libraryOnlyIds[item.id]) return;
    if (!best || finishedAt(item) > finishedAt(best)) best = item;
  };
  for (const id of state.orderedIds) {
    if (!state.engineRowsById[id]) consider(state.itemsById[id]);
  }
  for (const item of Object.values(state.engineRowsById)) consider(item);
  return best ? (best as DownloadItem).id : null;
}

/** "MP4 · 23.5 MB" from the item's own data: the proven container, else the file name's extension; the size when known. */
export function recentMetaLine(item: DownloadItem): string {
  const container = item.container && item.container !== 'unknown' ? item.container.toUpperCase() : null;
  const format = libraryFormatLabel(item.mimeType) ?? container ?? extractMediaType(item.fileName);
  const size = item.fileSize && item.fileSize !== '0' ? formatDownloadFileSize(item.fileSize) : null;
  return [format, size].filter(Boolean).join(' · ');
}

function notify(message: string): void {
  if (Platform.OS === 'android') ToastAndroid.show(message, ToastAndroid.SHORT);
  AccessibilityInfo.announceForAccessibility(message);
}

/**
 * Design 1 "RECENT": the most recent finished download as a card — thumbnail, title, "MP4 · 23.5 MB", and ⋮ with
 * the actions Downloads offers a finished item (Play, Share, Show in folder when a copy was saved, Details).
 * Renders nothing (no label either) when there is no finished download yet.
 */
export const RecentDownloadCard = memo(function RecentDownloadCard({ testID = 'browser-home-recent' }: { testID?: string }) {
  const { t, rtl } = useTranslation();
  const id = useDownloadsStore(selectLatestCompletedId);
  const item = useDownloadsStore((state) => (id ? (state.engineRowsById[id] ?? state.itemsById[id] ?? null) : null));
  const copyRecord = useExternalCopiesStore((state) => (id ? state.records[id] : undefined));
  const [menuOpen, setMenuOpen] = useState(false);

  // The catalog page is loaded by the Downloads tab; the start page can be first, so make sure it is loaded once.
  useEffect(() => {
    const state = useDownloadsStore.getState();
    if (!state.initialized && !state.loading) {
      void state.load().catch(() => undefined);
    }
  }, []);

  const closeMenu = useCallback(() => setMenuOpen(false), []);
  const openMenu = useCallback(() => setMenuOpen(true), []);

  const play = useCallback(async () => {
    if (!id) return;
    try {
      const { openCompletedFile } = await import('@/downloads/completed-file/action-service');
      const result = await openCompletedFile(id);
      if (!result.ok) notify(translate(completedActionErrorMessageKey(result.error.code) as TranslationKey));
    } catch {
      notify(translate('files.unavailable'));
    }
  }, [id]);

  const share = useCallback(async () => {
    if (!id) return;
    try {
      const { shareCompletedFile } = await import('@/downloads/completed-file/action-service');
      const result = await shareCompletedFile(id);
      if (!result.ok) notify(translate(completedActionErrorMessageKey(result.error.code) as TranslationKey));
    } catch {
      notify(translate('files.unavailable'));
    }
  }, [id]);

  if (!id || !item) {
    return null;
  }

  const title = item.title.trim() || item.fileName;
  const canShowInFolder = showInFolderTarget(copyRecord) != null;
  const actions: ActionSheetItem[] = [
    { id: 'play', label: t('lightHome.recentPlay'), onPress: () => void play() },
    { id: 'share', label: t('lightHome.recentShare'), onPress: () => void share() },
    ...(canShowInFolder
      ? [{ id: 'folder', label: t('lightHome.recentShowInFolder'), onPress: () => void showItemInFolder(id) }]
      : []),
    { id: 'details', label: t('lightHome.recentDetails'), onPress: () => navigation.push(downloadDetailsPath(id)) },
  ];

  return (
    <View testID={testID}>
      <DsSectionLabel>{t('lightHome.recent')}</DsSectionLabel>
      <DsCard style={{ paddingVertical: 11 }} testID={`${testID}-card`}>
        <View style={{ flexDirection: rtl.rowDirection, alignItems: 'center', gap: 12 }}>
          <DsThumb uri={item.thumbnailUrl || null} kind="video" width={62} height={45} />
          <View style={{ flex: 1, gap: 1 }}>
            <DsText variant="rowTitle" numberOfLines={1}>
              {title}
            </DsText>
            <DsText variant="rowSub" numberOfLines={1}>
              {recentMetaLine(item)}
            </DsText>
          </View>
          <DsIconButton
            variant="plain"
            icon="ellipsis-vertical"
            accessibilityLabel={t('lightHome.recentMenuA11y', { title })}
            onPress={openMenu}
            testID={`${testID}-menu`}
          />
        </View>
      </DsCard>
      <ActionSheetModal visible={menuOpen} title={title} actions={actions} onClose={closeMenu} testID={`${testID}-sheet`} />
    </View>
  );
});
