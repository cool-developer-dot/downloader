import { memo, useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { AccessibilityInfo, ActivityIndicator, FlatList, Platform, ToastAndroid, useWindowDimensions, View } from 'react-native';

import { ActionSheetModal } from '@/components/bottom-sheets/ActionSheetModal';
import type { ActionSheetItem } from '@/components/bottom-sheets/ActionSheet';
import { ConfirmModal } from '@/components/modals/ConfirmModal';
import { ds, DsButton, DsCard, DsChip, DsChipRow, DsFab, DsIcon, DsRowGroup, DsText } from '@/design';
import { ensureGalleryPermission } from '@/downloads/v2/gallery-permission';
import { formatFileSize } from '@/media-detection/utils/format';
import { useTheme } from '@/hooks/use-theme';
import { useTranslation, type TranslationKey } from '@/localization';
import { closePlayerSession } from '@/player/session-host/player-session-store';
import { exportVaultItem } from '@/private-vault/vault-export';
import { dataLossNotice } from '@/private-vault/data-loss';
import {
  findVaultItem,
  vaultIndexFrom,
  withoutVaultItem,
  type VaultItem,
} from '@/private-vault/vault-index';
import { IDLE_PLAYBACK, reduceVaultPlayback, type VaultPlayback, type VaultPlaybackEvent } from '@/private-vault/vault-playback';
import { clearVaultPlayback, getVaultPort, pickExportFolder } from '@/private-vault/vault-port';
import { usePrivateVaultPrefs } from '@/private-vault/vault-prefs-store';
import { privateFolderItemActions, type PrivateFolderAction } from '@/privacy/private-folder';
import { moveOutOfPrivateFolder } from '@/privacy/private-folder.runtime';
import { formatUsagePercent } from '@/storage-manager/utils/format-bytes';

import { AddFilesModal } from './AddFilesModal';
import { PrivateDataLossNotice } from './PrivateDataLossNotice';
import { filterVaultItems, PRIVATE_FILTERS, type PrivateFilter } from './private-filters';
import { protectionRows } from './ProtectionRows';
import { VaultGridTile } from './VaultGridTile';
import { VaultPlayerModal } from './VaultPlayerModal';

// P11 #686: 'move-out' — to the Gallery, then out of Private.
type Confirm = { kind: 'delete' | 'export-gallery' | 'export-folder' | 'move-out'; id: string };
type Busy = { id: string; kind: Confirm['kind']; percent: string | null };

/** How often a long decryption's progress is read (memory only on the native side). */
const PROGRESS_POLL_MS = 500;

/** Design 29: a 3-column grid of the vault's items. */
const GRID_COLUMNS = 3;

const FILTER_LABELS: Record<PrivateFilter, TranslationKey> = {
  all: 'fileManager.chipAll',
  videos: 'filesTab.videos',
  photos: 'fileManager.chipPhotos',
  audio: 'filesTab.audio',
};

function GridGap() {
  return <View style={{ height: ds.space.grid }} />;
}

function announce(message: string): void {
  if (Platform.OS === 'android') {
    ToastAndroid.show(message, ToastAndroid.SHORT);
  }
  AccessibilityInfo.announceForAccessibility(message);
}

function errorCode(error: unknown): unknown {
  return error && typeof error === 'object' ? (error as { code?: unknown }).code : undefined;
}

/**
 * The unlocked Private section (design 29, Files F10): the info card, the All / Videos / Photos / Audio chips, the
 * vault's items in a 3-column grid with Play, Export (Gallery or a picked folder), Move out and Delete — each export
 * and delete behind a confirm — the three protections that are always on, and "+ Add files". Mounted only while
 * unlocked: when the section locks this unmounts, which drops the list and the decrypted thumbnails from memory and
 * deletes the playback file.
 */
export const PrivateVaultList = memo(function PrivateVaultList() {
  const { t, rtl } = useTranslation();
  const theme = useTheme();
  const { width } = useWindowDimensions();
  const [filter, setFilter] = useState<PrivateFilter>('all');
  const [addOpen, setAddOpen] = useState(false);
  const port = getVaultPort();
  const [items, setItems] = useState<VaultItem[]>([]);
  const [status, setStatus] = useState<'loading' | 'ready' | 'error'>('loading');
  const [thumbnails, setThumbnails] = useState<Record<string, string>>({});
  const [sheetId, setSheetId] = useState<string | null>(null);
  const [confirm, setConfirm] = useState<Confirm | null>(null);
  const [busy, setBusy] = useState<Busy | null>(null);
  const [playback, setPlayback] = useState<VaultPlayback>(IDLE_PLAYBACK);
  const [playPercent, setPlayPercent] = useState<string | null>(null);
  const itemsRef = useRef<VaultItem[]>([]);
  const busyRef = useRef(false);
  const playbackRef = useRef<VaultPlayback>(IDLE_PLAYBACK);
  const tokenRef = useRef(0);
  const liveRef = useRef(true);

  const applyPlayback = useCallback((event: VaultPlaybackEvent) => {
    const step = reduceVaultPlayback(playbackRef.current, event);
    playbackRef.current = step.state;
    if (liveRef.current) {
      setPlayback(step.state);
    }
    if (step.clearTemp) {
      clearVaultPlayback();
    }
  }, []);

  const load = useCallback(async () => {
    if (!port) {
      return;
    }
    try {
      const next = vaultIndexFrom(await port.listVault());
      if (!liveRef.current) {
        return;
      }
      itemsRef.current = next;
      setItems(next);
      setStatus('ready');
      // Thumbnails one at a time, into memory only.
      for (const item of next) {
        if (!item.hasThumbnail || !liveRef.current) {
          continue;
        }
        const uri = await port.getVaultThumbnail(item.id).catch(() => null);
        if (uri && liveRef.current) {
          setThumbnails((current) => ({ ...current, [item.id]: uri }));
        }
      }
    } catch {
      if (liveRef.current) {
        setStatus('error');
      }
    }
  }, [port]);

  useEffect(() => {
    liveRef.current = true;
    // Loaded from a microtask right after mount, so the effect body itself sets no state.
    void Promise.resolve().then(() => load());
    return () => {
      liveRef.current = false;
      // Locked or left: the decrypted file goes, whatever was playing.
      applyPlayback({ type: 'left-section' });
    };
  }, [applyPlayback, load]);

  const preparingId = playback.phase === 'preparing' ? playback.itemId : null;
  useEffect(() => {
    if (!preparingId || !port) {
      return undefined;
    }
    const timer = setInterval(() => {
      const progress = port.getVaultProgress(preparingId);
      setPlayPercent(progress && progress.totalBytes > 0 ? formatUsagePercent(progress.bytesDone / progress.totalBytes) : null);
    }, PROGRESS_POLL_MS);
    return () => clearInterval(timer);
  }, [port, preparingId]);

  const busyId = busy?.id ?? null;
  useEffect(() => {
    if (!busyId || !port) {
      return undefined;
    }
    const timer = setInterval(() => {
      const progress = port.getVaultProgress(busyId);
      const percent = progress && progress.totalBytes > 0 ? formatUsagePercent(progress.bytesDone / progress.totalBytes) : null;
      setBusy((current) => (current && current.id === busyId ? { ...current, percent } : current));
    }, PROGRESS_POLL_MS);
    return () => clearInterval(timer);
  }, [busyId, port]);

  const play = useCallback(
    async (id: string) => {
      if (!port || busyRef.current || playbackRef.current.phase !== 'idle') {
        return;
      }
      // Read right before acting: it may have been deleted meanwhile, and an unreadable item never plays.
      const target = findVaultItem(itemsRef.current, id);
      if (!target || target.unreadable) {
        return;
      }
      // The app's own player (and its mini player) stops, so two videos never play at once.
      closePlayerSession();
      setPlayPercent(null);
      const token = ++tokenRef.current;
      applyPlayback({ type: 'open', token, itemId: id });
      try {
        const uri = await port.openVaultItem(id);
        applyPlayback({ type: 'ready', token, uri });
      } catch (error) {
        applyPlayback({ type: 'failed', token });
        announce(errorCode(error) === 'ERR_VAULT_CORRUPT' ? t('privateVault.corrupt') : t('privateVault.playFailed'));
      }
    },
    [applyPlayback, port, t],
  );

  const closePlayer = useCallback(() => applyPlayback({ type: 'close' }), [applyPlayback]);

  const runConfirmed = useCallback(async () => {
    const pending = confirm;
    setConfirm(null);
    if (!pending || !port || busyRef.current) {
      return;
    }
    // Read right before acting; an item that cannot be opened can only be deleted.
    const target = findVaultItem(itemsRef.current, pending.id);
    if (!target || (target.unreadable && pending.kind !== 'delete')) {
      return;
    }
    busyRef.current = true;
    setBusy({ id: pending.id, kind: pending.kind, percent: null });
    try {
      if (pending.kind === 'delete') {
        await port.deleteVaultItem(pending.id);
        const next = withoutVaultItem(itemsRef.current, pending.id) as VaultItem[];
        itemsRef.current = next;
        if (liveRef.current) {
          setItems(next);
          setThumbnails((current) => {
            const copy = { ...current };
            delete copy[pending.id];
            return copy;
          });
        }
        announce(t('privateVault.deleted'));
      } else if (pending.kind === 'move-out') {
        // P11: the Gallery copy first (its permission prompt never relocks Private); the private copy goes only after.
        const result = await moveOutOfPrivateFolder(pending.id, itemsRef.current);
        if (result.ok) {
          const next = withoutVaultItem(itemsRef.current, pending.id) as VaultItem[];
          itemsRef.current = next;
          if (liveRef.current) {
            setItems(next);
            setThumbnails((current) => {
              const copy = { ...current };
              delete copy[pending.id];
              return copy;
            });
          }
          announce(t('privacyBackup.movedOut'));
        } else if (result.reason !== 'cancelled') {
          announce(
            result.reason === 'corrupt'
              ? t('privateVault.corrupt')
              : result.reason === 'permission'
                ? t('privateVault.galleryPermissionNeeded')
                : result.reason === 'still-in-private'
                  ? t('privacyBackup.moveOutKept')
                  : t('privacyBackup.moveOutFailed'),
          );
        }
      } else {
        // Runs to the end even if the section locks meanwhile; its picker or permission prompt never relocks it.
        const result = await exportVaultItem(pending.kind === 'export-gallery' ? 'gallery' : 'folder', pending.id, {
          requestGalleryPermission: ensureGalleryPermission,
          pickFolder: pickExportFolder,
          exportToGallery: (vaultId) => port.exportVaultItemToGallery(vaultId),
          exportToFolder: (vaultId, treeUri) => port.exportVaultItemToFolder(vaultId, treeUri),
        });
        if (result.ok) {
          announce(pending.kind === 'export-gallery' ? t('privateVault.exportedGallery') : t('privateVault.exportedFolder'));
        } else if (result.reason !== 'cancelled') {
          announce(
            result.reason === 'corrupt'
              ? t('privateVault.corrupt')
              : result.reason === 'permission'
                ? t('privateVault.galleryPermissionNeeded')
                : t('privateVault.exportFailed'),
          );
        }
      }
    } catch (error) {
      const code = errorCode(error);
      announce(
        code === 'ERR_VAULT_CORRUPT'
          ? t('privateVault.corrupt')
          : code === 'ERR_STORAGE_PERMISSION'
            ? t('privateVault.galleryPermissionNeeded')
            : pending.kind === 'delete'
              ? t('privateVault.deleteFailed')
              : t('privateVault.exportFailed'),
      );
    } finally {
      busyRef.current = false;
      if (liveRef.current) {
        setBusy(null);
      }
    }
  }, [confirm, port, t]);

  const sheetItem = sheetId ? findVaultItem(items, sheetId) : null;
  const sheetActions = useMemo<ActionSheetItem[]>(() => {
    const item = sheetId ? findVaultItem(items, sheetId) : null;
    if (!item) {
      return [];
    }
    const id = item.id;
    const all: Record<PrivateFolderAction, ActionSheetItem> = {
      play: {
        id: 'play',
        label: t('common.play'),
        onPress: () => {
          setSheetId(null);
          void play(id);
        },
      },
      'export-gallery': {
        id: 'export-gallery',
        label: t('privateVault.exportGallery'),
        onPress: () => {
          setSheetId(null);
          setConfirm({ kind: 'export-gallery', id });
        },
      },
      'export-folder': {
        id: 'export-folder',
        label: t('privateVault.exportFolder'),
        onPress: () => {
          setSheetId(null);
          setConfirm({ kind: 'export-folder', id });
        },
      },
      'move-out': {
        id: 'move-out',
        label: t('privacyBackup.moveOut'),
        onPress: () => {
          setSheetId(null);
          setConfirm({ kind: 'move-out', id });
        },
      },
      delete: {
        id: 'delete',
        label: t('common.delete'),
        onPress: () => {
          setSheetId(null);
          setConfirm({ kind: 'delete', id });
        },
      },
    };
    // An item that cannot be opened offers only Delete. P11 adds Move out (before Delete) for one that opens.
    return privateFolderItemActions(item).map((action) => all[action]);
  }, [items, play, sheetId, t]);

  const confirmItem = confirm ? findVaultItem(items, confirm.id) : null;
  const confirmTitle = confirmItem?.title || t('privateVault.untitled');
  const confirmUnreadable = confirmItem?.unreadable === true;

  const tileSize = Math.floor((width - ds.space.screenX * 2 - ds.space.grid * (GRID_COLUMNS - 1)) / GRID_COLUMNS);
  const shownItems = useMemo(() => filterVaultItems(items, filter), [filter, items]);

  const renderItem = useCallback(
    ({ item }: { item: VaultItem }) => (
      <VaultGridTile item={item} thumbnail={thumbnails[item.id] ?? null} size={tileSize} onPlay={(id) => void play(id)} onMore={setSheetId} />
    ),
    [play, thumbnails, tileSize],
  );

  const dataLossAcknowledged = usePrivateVaultPrefs((s) => s.dataLossAcknowledged);

  if (status === 'loading') {
    return (
      <View style={{ flex: 1, alignItems: 'center', justifyContent: 'center' }}>
        <ActivityIndicator color={theme.colors.primary} accessibilityLabel={t('common.loading')} />
      </View>
    );
  }

  if (status === 'error') {
    return (
      <View style={{ paddingHorizontal: ds.space.screenX, paddingTop: 12 }}>
        <DsCard>
          <View style={{ gap: 12 }}>
            <DsText variant="body">{t('privateVault.loadFailed')}</DsText>
            <DsButton
              label={t('common.retry')}
              variant="secondary"
              onPress={() => {
                setStatus('loading');
                void load();
              }}
            />
          </View>
        </DsCard>
      </View>
    );
  }

  return (
    <View style={{ flex: 1 }}>
      <FlatList
        data={shownItems}
        keyExtractor={(item) => item.id}
        renderItem={renderItem}
        numColumns={GRID_COLUMNS}
        columnWrapperStyle={{ gap: ds.space.grid, flexDirection: rtl.rowDirection }}
        ItemSeparatorComponent={GridGap}
        contentContainerStyle={{ paddingHorizontal: ds.space.screenX, paddingBottom: 96, flexGrow: 1 }}
        ListHeaderComponent={
          <View style={{ gap: ds.space.stack, paddingTop: 4, paddingBottom: ds.space.stack }}>
            {busy ? (
              <DsText variant="body" accessibilityLiveRegion="polite">
                {busy.kind === 'delete'
                  ? t('privateVault.deleting')
                  : busy.kind === 'move-out'
                    ? busy.percent
                      ? t('privacyBackup.movingOut', { percent: busy.percent })
                      : t('privacyBackup.movingOutPlain')
                  : busy.percent
                    ? t('privateVault.exporting', { percent: busy.percent })
                    : t('privateVault.exportingPlain')}
              </DsText>
            ) : null}
            {/* Design 29's info card. */}
            <DsCard testID="private-info-card">
              <View style={{ flexDirection: rtl.rowDirection, gap: 10, alignItems: 'flex-start' }}>
                <DsIcon name="shield" size={18} color="textPrimary" strokeWidth={1.8} />
                <DsText variant="bodyStrong" style={{ flex: 1 }}>
                  {t('fileManager.vaultInfo')}
                </DsText>
              </View>
            </DsCard>
            {/* Until the first move was acknowledged the whole warning, then a one-line reminder. */}
            <PrivateDataLossNotice compact={dataLossNotice(dataLossAcknowledged) === 'compact'} />
            <DsChipRow>
              {PRIVATE_FILTERS.map((value) => (
                <DsChip
                  key={value}
                  label={t(FILTER_LABELS[value])}
                  selected={filter === value}
                  onPress={() => setFilter(value)}
                  testID={`private-chip-${value}`}
                />
              ))}
            </DsChipRow>
          </View>
        }
        ListEmptyComponent={
          <DsCard testID="private-empty">
            <View style={{ gap: 6, alignItems: 'center', paddingVertical: 8 }}>
              <DsText variant="bodyStrong" align="center">
                {items.length > 0 ? t('fileManager.vaultFilterEmpty') : t('privateVault.emptyTitle')}
              </DsText>
              {items.length > 0 ? null : (
                <DsText variant="body" align="center">
                  {t('privateVault.emptyDescription')}
                </DsText>
              )}
            </View>
          </DsCard>
        }
        ListFooterComponent={
          <DsRowGroup style={{ marginTop: ds.space.stack }} testID="private-protections">
            {protectionRows(t, 'private-protection')}
          </DsRowGroup>
        }
        testID="private-list"
      />

      <DsFab
        label={t('fileManager.addFiles')}
        icon="plus"
        onPress={() => setAddOpen(true)}
        testID="private-add-files-button"
      />
      <AddFilesModal visible={addOpen} onClose={() => setAddOpen(false)} onMoved={() => void load()} />

      <ActionSheetModal
        visible={sheetItem !== null}
        onClose={() => setSheetId(null)}
        title={sheetItem?.unreadable ? t('privateVault.unreadableTitle') : sheetItem?.title || t('privateVault.untitled')}
        subtitle={t('privateVault.actionsSubtitle')}
        actions={sheetActions}
        testID="private-actions"
      />

      <ConfirmModal
        visible={confirm !== null}
        variant={confirm?.kind === 'delete' ? 'delete' : 'warning'}
        title={
          confirm?.kind === 'delete' && confirmUnreadable
            ? t('privateVault.deleteUnreadableTitle')
            : confirm?.kind === 'delete'
              ? t('privateVault.deleteTitle')
            : confirm?.kind === 'move-out'
              ? t('privacyBackup.moveOutTitle')
            : confirm?.kind === 'export-folder'
              ? t('privateVault.exportFolderTitle')
              : t('privateVault.exportGalleryTitle')
        }
        message={
          confirm?.kind === 'delete' && confirmUnreadable
            ? t('privateVault.deleteUnreadableMessage', { size: formatFileSize(confirmItem?.sizeBytes ?? 0) ?? '' })
            : confirm?.kind === 'delete'
              ? t('privateVault.deleteMessage', { title: confirmTitle })
            : confirm?.kind === 'move-out'
              ? t('privacyBackup.moveOutMessage', { title: confirmTitle })
            : confirm?.kind === 'export-folder'
              ? t('privateVault.exportFolderMessage', { title: confirmTitle })
              : t('privateVault.exportGalleryMessage', { title: confirmTitle })
        }
        confirmLabel={
          confirm?.kind === 'delete'
            ? t('common.delete')
            : confirm?.kind === 'move-out'
              ? t('privacyBackup.moveOutConfirm')
              : t('privateVault.export')
        }
        cancelLabel={t('common.cancel')}
        onConfirm={() => {
          void runConfirmed();
        }}
        onCancel={() => setConfirm(null)}
        testID="private-confirm"
      />

      <VaultPlayerModal
        uri={playback.phase === 'playing' ? playback.uri : null}
        preparing={playback.phase === 'preparing'}
        percent={playPercent}
        onClose={closePlayer}
      />
    </View>
  );
});
