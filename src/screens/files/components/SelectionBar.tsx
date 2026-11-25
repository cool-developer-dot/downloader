import { memo, useCallback, useMemo, useState } from 'react';
import { View } from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';

import type { ActionSheetItem } from '@/components/bottom-sheets/ActionSheet';
import { ActionSheetModal } from '@/components/bottom-sheets/ActionSheetModal';
import { Pressable } from '@/components/base/Pressable';
import { ConfirmModal } from '@/components/modals/ConfirmModal';
import { ds, DsIcon, DsText, type DsIconName } from '@/design';
import { confirmLibraryFileAction } from '@/downloads/safety/file-safety-dialog';
import { getV2Engine } from '@/downloads/v2/engine-port';
import { batchActionsFor, type BatchAction, type BatchItem } from '@/files/ui/batch-actions';
import { listFolder, type FileEntry, type FolderEntry } from '@/files/ui/files-source';
import { isConfirmBeforeDeleteOn } from '@/files/ui/files-view-settings';
import { useTheme } from '@/hooks/use-theme';
import { useTranslation, type TranslationKey } from '@/localization';
import { canMoveToPrivate } from '@/private-vault/move-to-private.runtime';
import { AddToPlaylistSheet } from '@/screens/playlists/components/AddToPlaylistSheet';
import type { PlaylistItemInput } from '@/storage/repositories/playlists.repository';
import { useMediaFolderAssignmentsStore } from '@/store/organization/folder-assignments';

import { announce } from '../announce';
import { NewFolderDialog } from './NewFolderDialog';
import { PrivateBatchMoveDialog } from './PrivateBatchMoveDialog';

/** A selected row: a file or a folder. */
export type SelectedEntry = { kind: 'file'; file: FileEntry } | { kind: 'folder'; folder: FolderEntry };

/** What later packages put in More ⋮ (F5 Rename, F7 Tag, Color and Hide). */
export type MoreAction = { id: string; label: string; onPress: (entries: readonly SelectedEntry[]) => void };

export type SelectionBarProps = {
  entries: readonly SelectedEntry[];
  /** After an action: leave selection mode and reload. */
  onDone: () => void;
  moreActions?: readonly MoreAction[];
  testID?: string;
};

const BUTTONS: { action: BatchAction; icon: DsIconName; label: TranslationKey }[] = [
  { action: 'move', icon: 'folder-open', label: 'fileManager.batchMove' },
  { action: 'share', icon: 'share-2', label: 'common.share' },
  { action: 'delete', icon: 'trash-2', label: 'common.delete' },
  { action: 'add-to-playlist', icon: 'list', label: 'fileManager.batchPlaylist' },
  { action: 'move-to-private', icon: 'lock', label: 'fileManager.batchPrivate' },
  { action: 'more', icon: 'ellipsis-vertical', label: 'fileManager.batchMore' },
];

/**
 * Files F4: the bar at the bottom while selecting — Move to folder (with "New folder here"), Share (all the files in
 * one share sheet; hidden while a folder is selected), Delete (the app's delete; Confirm before delete applies; it
 * goes to the bin once F8 lands), Add to playlist (only when every item can play), Move to Private (one confirm, then
 * one file after another through the existing move), and More ⋮ when a later package fills it.
 */
export const SelectionBar = memo(function SelectionBar({ entries, onDone, moreActions = [], testID = 'files-selection-bar' }: SelectionBarProps) {
  const theme = useTheme();
  const insets = useSafeAreaInsets();
  const { t, rtl } = useTranslation();
  const files = useMemo(() => entries.flatMap((entry) => (entry.kind === 'file' ? [entry.file] : [])), [entries]);
  const items = useMemo<BatchItem[]>(
    () =>
      entries.map((entry) =>
        entry.kind === 'folder'
          ? { kind: 'folder', id: entry.folder.id }
          : { kind: 'file', id: entry.file.id, type: entry.file.type, canMoveToPrivate: canMoveToPrivate(entry.file.id) },
      ),
    [entries],
  );
  const states = batchActionsFor(items, { moreItems: moreActions.length });

  const [folderPicker, setFolderPicker] = useState<FolderEntry[] | null>(null);
  const [newFolderOpen, setNewFolderOpen] = useState(false);
  const [confirmDelete, setConfirmDelete] = useState(false);
  const [deleting, setDeleting] = useState(false);
  const [playlistInputs, setPlaylistInputs] = useState<PlaylistItemInput[] | null>(null);
  const [moreOpen, setMoreOpen] = useState(false);
  const [privateFiles, setPrivateFiles] = useState<readonly FileEntry[] | null>(null);

  const moveTo = useCallback(
    async (folderId: string | null, folderName: string) => {
      setFolderPicker(null);
      const store = useMediaFolderAssignmentsStore.getState();
      let moved = 0;
      for (const file of files) {
        try {
          await store.moveMediaToFolder({ mediaId: file.id, desiredFolderId: folderId, fallbackFolderId: file.folderId });
          moved += 1;
        } catch {
          // counted below
        }
      }
      announce(t('fileManager.movedCount', { count: moved, folder: folderName }));
      if (moved < files.length) announce(t('fileManager.moveFailed', { count: files.length - moved }));
      onDone();
    },
    [files, onDone, t],
  );

  const deleteNow = useCallback(async () => {
    setDeleting(true);
    let deleted = 0;
    try {
      const { deleteCompletedFileFromVidoraX } = await import('@/downloads/completed-file/delete/delete-service');
      for (const file of files) {
        const result = await deleteCompletedFileFromVidoraX(file.id).catch(() => ({ ok: false as const }));
        if (result.ok) deleted += 1;
      }
    } finally {
      setDeleting(false);
      setConfirmDelete(false);
    }
    announce(t('fileManager.deletedCount', { count: deleted }));
    if (files.length < entries.length) announce(t('fileManager.foldersNotDeleted'));
    onDone();
  }, [entries.length, files, onDone, t]);

  const share = useCallback(async () => {
    const engine = getV2Engine();
    const ids: string[] = [];
    for (const file of files) {
      // P8 #461: the warning for a file that isn't what its name says, before it leaves the app.
      if (await confirmLibraryFileAction(file.id, 'share', file.name)) ids.push(file.id);
    }
    if (ids.length === 0) return;
    try {
      if (!engine) throw new Error('unavailable');
      await engine.share(ids);
      onDone();
    } catch {
      announce(t('files.shareFailed'));
    }
  }, [files, onDone, t]);

  const run = useCallback(
    (action: BatchAction) => {
      switch (action) {
        case 'move':
          void listFolder(null).then((listing) => setFolderPicker(listing.folders));
          return;
        case 'share':
          void share();
          return;
        case 'delete':
          if (isConfirmBeforeDeleteOn()) setConfirmDelete(true);
          else void deleteNow();
          return;
        case 'add-to-playlist':
          setPlaylistInputs(files.map((file) => ({ mediaId: file.id, title: file.title, fileName: file.name, durationSeconds: null })));
          return;
        case 'move-to-private':
          setPrivateFiles(files);
          return;
        case 'more':
          setMoreOpen(true);
          return;
        default:
          return;
      }
    },
    [deleteNow, files, share],
  );

  const pickerActions = useMemo<ActionSheetItem[]>(
    () =>
      folderPicker
        ? [
            { id: 'none', label: t('fileManager.moveNoFolder'), onPress: () => void moveTo(null, t('fileManager.moveNoFolder')) },
            ...folderPicker.map((folder) => ({ id: folder.id, label: folder.name, onPress: () => void moveTo(folder.id, folder.name) })),
            {
              id: 'new-folder',
              label: t('fileManager.newFolderHere'),
              onPress: () => {
                setFolderPicker(null);
                setNewFolderOpen(true);
              },
            },
          ]
        : [],
    [folderPicker, moveTo, t],
  );

  const moreSheet = useMemo<ActionSheetItem[]>(
    () =>
      moreActions.map((more) => ({
        id: more.id,
        label: more.label,
        onPress: () => {
          setMoreOpen(false);
          more.onPress(entries);
        },
      })),
    [entries, moreActions],
  );

  return (
    <>
      <View
        testID={testID}
        accessibilityLabel={t('fileManager.batchBar')}
        style={{
          flexDirection: rtl.rowDirection,
          justifyContent: 'space-around',
          paddingTop: 8,
          paddingBottom: Math.max(insets.bottom, 8),
          paddingHorizontal: ds.space.screenX,
          backgroundColor: theme.colors.card,
          borderTopWidth: 1,
          borderTopColor: theme.colors.cardBorder,
        }}>
        {BUTTONS.filter((button) => states[button.action].visible).map((button) => {
          const enabled = states[button.action].enabled;
          return (
            <Pressable
              key={button.action}
              onPress={() => run(button.action)}
              disabled={!enabled}
              accessibilityRole="button"
              accessibilityLabel={t(button.label)}
              accessibilityState={{ disabled: !enabled }}
              testID={`${testID}-${button.action}`}
              style={{ alignItems: 'center', gap: 3, minWidth: 52, paddingVertical: 4, opacity: enabled ? 1 : 0.4 }}>
              <DsIcon name={button.icon} size={20} color={button.action === 'delete' ? 'primary' : 'textPrimary'} strokeWidth={1.8} />
              <DsText variant="rowSub" numberOfLines={1}>
                {t(button.label)}
              </DsText>
            </Pressable>
          );
        })}
      </View>

      <ActionSheetModal visible={folderPicker !== null} onClose={() => setFolderPicker(null)} title={t('downloads.moveToFolder')} actions={pickerActions} testID={`${testID}-move`} />
      <NewFolderDialog
        visible={newFolderOpen}
        onClose={() => setNewFolderOpen(false)}
        onCreated={(folder) => void moveTo(folder.id, folder.name)}
      />
      <ConfirmModal
        visible={confirmDelete}
        variant="delete"
        title={t('fileManager.deleteManyTitle', { count: files.length })}
        message={t('fileManager.deleteManyMessage')}
        confirmLabel={t('library.deleteConfirm')}
        cancelLabel={t('library.deleteCancel')}
        loading={deleting}
        onConfirm={() => void deleteNow()}
        onCancel={() => {
          if (!deleting) setConfirmDelete(false);
        }}
        testID={`${testID}-delete`}
      />
      <AddToPlaylistSheet inputs={playlistInputs} onClose={() => setPlaylistInputs(null)} onAdded={onDone} />
      <ActionSheetModal visible={moreOpen} onClose={() => setMoreOpen(false)} actions={moreSheet} testID={`${testID}-more`} />
      <PrivateBatchMoveDialog
        files={privateFiles}
        onClose={() => setPrivateFiles(null)}
        onDone={() => {
          setPrivateFiles(null);
          onDone();
        }}
      />
    </>
  );
});
