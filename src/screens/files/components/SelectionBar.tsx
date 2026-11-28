import { memo, useCallback, useMemo, useState } from 'react';
import { View } from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';

import type { ActionSheetItem } from '@/components/bottom-sheets/ActionSheet';
import { ActionSheetModal } from '@/components/bottom-sheets/ActionSheetModal';
import { Pressable } from '@/components/base/Pressable';
import { ds, DsIcon, DsText, type DsIconName } from '@/design';
import { confirmLibraryFileAction } from '@/downloads/safety/file-safety-dialog';
import { getV2Engine } from '@/downloads/v2/engine-port';
import { batchActionsFor, type BatchAction, type BatchItem } from '@/files/ui/batch-actions';
import { requestDelete } from '@/files/trash/useDeleteWithUndo';
import { isSystemDownloadId } from '@/files/system-downloads/system-downloads';
import { fileLabel } from '@/files/ui/file-fields';
import { filesCapabilities, listFolder, moveFolder, type FileEntry, type FolderEntry } from '@/files/ui/files-source';
import { useTheme } from '@/hooks/use-theme';
import { useTranslation, type TranslationKey } from '@/localization';
import { canMoveToPrivate } from '@/private-vault/move-to-private.runtime';
import { AddToPlaylistSheet } from '@/screens/playlists/components/AddToPlaylistSheet';
import type { PlaylistItemInput } from '@/storage/repositories/playlists.repository';
import { useMediaFolderAssignmentsStore } from '@/store/organization/folder-assignments';

import { createClashResolver, findClash, keepBothName } from '@/files/rename/name-clash';
import { deleteForReplace, renameFileTo } from '@/files/rename/rename-runtime';

import { announce } from '../announce';
import { NameClashDialog, useNameClash } from './NameClashDialog';
import { NewFolderDialog } from './NewFolderDialog';
import { PrivateBatchMoveDialog } from './PrivateBatchMoveDialog';
import { SelectionMoreHost } from './SelectionMoreHost';

/** A selected row: a file or a folder. */
export type SelectedEntry = { kind: 'file'; file: FileEntry } | { kind: 'folder'; folder: FolderEntry };

/** What later packages put in More ⋮ (F5 Rename, F7 Tag, Color and Hide). `done` leaves selection mode and reloads. */
export type MoreAction = { id: string; label: string; onPress: (entries: readonly SelectedEntry[], done: () => void) => void };

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
  const folders = useMemo(() => entries.flatMap((entry) => (entry.kind === 'folder' ? [entry.folder] : [])), [entries]);
  // Files the browser handed to Android's DownloadManager only delete here; moving, sharing in one sheet, playlists and
  // Private are for VidoraX's own library files.
  const libraryFiles = useMemo(() => files.filter((file) => !isSystemDownloadId(file.id)), [files]);
  const items = useMemo<BatchItem[]>(
    () =>
      entries.map((entry) =>
        entry.kind === 'folder'
          ? { kind: 'folder', id: entry.folder.id }
          : { kind: 'file', id: entry.file.id, type: entry.file.fileType, canMoveToPrivate: canMoveToPrivate(entry.file.id) },
      ),
    [entries],
  );
  // F12: moving a folder only once nested folders are live.
  const states = batchActionsFor(items, { moreItems: moreActions.length, nestedFolders: filesCapabilities.nestedFolders });

  const [folderPicker, setFolderPicker] = useState<FolderEntry[] | null>(null);
  const [newFolderOpen, setNewFolderOpen] = useState(false);
  const [playlistInputs, setPlaylistInputs] = useState<PlaylistItemInput[] | null>(null);
  const [moreOpen, setMoreOpen] = useState(false);
  const [privateFiles, setPrivateFiles] = useState<readonly FileEntry[] | null>(null);
  const clash = useNameClash();

  const moveTo = useCallback(
    async (folderId: string | null, folderName: string) => {
      setFolderPicker(null);
      const store = useMediaFolderAssignmentsStore.getState();
      // F5 #797: what is already in the target folder (not the files being moved).
      const movingIds = new Set(libraryFiles.map((file) => file.id));
      const there = (await listFolder(folderId).catch(() => null))?.files.filter((file) => !movingIds.has(file.id)) ?? [];
      const names = there.map((file) => fileLabel(file));
      // "Do this for all" (#797): each clash asks until an answer is for all.
      let clashingName = '';
      const choose = createClashResolver(() => clash.ask(clashingName, folderName, libraryFiles.length > 1));
      let moved = 0;
      for (const file of libraryFiles) {
        try {
          if (file.folderId === folderId) {
            continue;
          }
          const clashing = findClash(fileLabel(file), names);
          if (clashing) {
            clashingName = fileLabel(file);
            const choice = await choose();
            if (choice === 'skip') continue;
            if (choice === 'keep-both') {
              const next = keepBothName(fileLabel(file), names);
              await renameFileTo(file.id, next);
              names.push(next);
            } else {
              const victim = there.find((other) => fileLabel(other).toLocaleLowerCase() === clashing.toLocaleLowerCase());
              if (victim) await deleteForReplace(victim.id);
            }
          } else {
            names.push(fileLabel(file));
          }
          await store.moveMediaToFolder({ mediaId: file.id, desiredFolderId: folderId, fallbackFolderId: file.folderId });
          moved += 1;
        } catch {
          // counted below
        }
      }
      // F12: the selected folders too, once nested folders are live (a folder can't go into itself or too deep).
      const movingFolders = filesCapabilities.nestedFolders ? folders : [];
      for (const folder of movingFolders) {
        try {
          await moveFolder(folder.id, folderId);
          moved += 1;
        } catch {
          // counted below
        }
      }
      const total = files.length + movingFolders.length;
      announce(t('fileManager.movedCount', { count: moved, folder: folderName }));
      if (moved < total) announce(t('fileManager.moveFailed', { count: total - moved }));
      onDone();
    },
    [clash, files, folders, libraryFiles, onDone, t],
  );

  const deleteNow = useCallback(() => {
    // F8: one door for every delete — F2's Confirm before delete, the bin, and the Undo bar.
    requestDelete({
      ids: files.map((file) => file.id),
      source: 'batch',
      name: files.length === 1 ? fileLabel(files[0]!) : undefined,
      onDone: () => {
        if (files.length < entries.length) announce(t('fileManager.foldersNotDeleted'));
        onDone();
      },
    });
  }, [entries.length, files, onDone, t]);

  const share = useCallback(async () => {
    const engine = getV2Engine();
    const ids: string[] = [];
    for (const file of libraryFiles) {
      // P8 #461: the warning for a file that isn't what its name says, before it leaves the app.
      if (await confirmLibraryFileAction(file.id, 'share', fileLabel(file))) ids.push(file.id);
    }
    if (ids.length === 0) return;
    try {
      if (!engine) throw new Error('unavailable');
      await engine.share(ids);
      onDone();
    } catch {
      announce(t('files.shareFailed'));
    }
  }, [libraryFiles, onDone, t]);

  const run = useCallback(
    (action: BatchAction) => {
      switch (action) {
        case 'move':
          // A folder being moved is never offered as where it goes.
          void listFolder(null).then((listing) => setFolderPicker(listing.folders.filter((folder) => !folders.some((moving) => moving.id === folder.id))));
          return;
        case 'share':
          void share();
          return;
        case 'delete':
          deleteNow();
          return;
        case 'add-to-playlist':
          setPlaylistInputs(libraryFiles.map((file) => ({ mediaId: file.id, title: file.displayName || fileLabel(file), fileName: file.fileName, durationSeconds: null })));
          return;
        case 'move-to-private':
          setPrivateFiles(libraryFiles);
          return;
        case 'more':
          setMoreOpen(true);
          return;
        default:
          return;
      }
    },
    [deleteNow, folders, libraryFiles, share],
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
          more.onPress(entries, onDone);
        },
      })),
    [entries, moreActions, onDone],
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
      <AddToPlaylistSheet inputs={playlistInputs} onClose={() => setPlaylistInputs(null)} onAdded={onDone} />
      <ActionSheetModal visible={moreOpen} onClose={() => setMoreOpen(false)} actions={moreSheet} testID={`${testID}-more`} />
      <NameClashDialog {...clash.dialogProps} />
      <SelectionMoreHost />
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
