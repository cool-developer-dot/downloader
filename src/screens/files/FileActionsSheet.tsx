import { memo, useCallback, useMemo, useState } from 'react';
import { Modal, Pressable as RNPressable, ScrollView, useWindowDimensions, View } from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';

import { ConfirmModal } from '@/components/modals/ConfirmModal';
import { ds, DsRow, DsRowGroup, DsText, type DsIconName } from '@/design';
import { completedActionErrorMessageKey } from '@/downloads/completed-file/action-errors';
import { confirmLibraryFileAction } from '@/downloads/safety/file-safety-dialog';
import { fileIntegrity } from '@/downloads/v2/file-integrity';
import { getTreeExportPort, pickTreeFolder } from '@/downloads/v2/tree-export-port';
import type { FileEntry } from '@/files/ui/files-index';
import { isConfirmBeforeDeleteOn } from '@/files/ui/files-view-settings';
import { useTheme } from '@/hooks/use-theme';
import { intlLocaleForLanguage, useTranslation, type TranslationKey } from '@/localization';
import { fileChecksumPath, fileDetailsPath, filesFolderPath, filesTypePath, navigation, routePaths } from '@/navigation';
import { canMoveToPrivate } from '@/private-vault/move-to-private.runtime';
import { RenameModal } from '@/screens/downloads/extras/file-actions/RenameModal';
import { PrivateMoveDialog } from '@/screens/private/PrivateMoveDialog';
import { usePrivateMove } from '@/screens/private/usePrivateMove';
import { useTourBlocker } from '@/tour/tour-store';

import { announce } from './announce';
import { fileActionsFor, type FileAction } from './utils/file-actions';
import { fileMetaLine } from './utils/file-rows';

export type FileActionsSheetProps = {
  /** The file whose ⋮ was tapped; null when the sheet is closed. */
  file: FileEntry | null;
  onClose: () => void;
  /** Play / open the file the way a tap on its row does. */
  onOpen: (file: FileEntry) => void;
  /** After a delete, a rename or a move to Private: the list reloads. */
  onChanged?: () => void;
  testID?: string;
};

type RowSpec = { icon: DsIconName; title: TranslationKey; subtitle?: TranslationKey; destructive?: boolean };

const ROWS: Record<FileAction, RowSpec> = {
  play: { icon: 'play', title: 'common.play' },
  details: { icon: 'info', title: 'fileManager.details' },
  'show-in-folder': { icon: 'folder-open', title: 'saveLocation.showInFolder' },
  share: { icon: 'share-2', title: 'common.share' },
  'send-to-device': { icon: 'smartphone', title: 'lightFileActions.sendToDevice', subtitle: 'fileManager.sendToDeviceSub' },
  'save-to': { icon: 'cloud', title: 'fileManager.saveTo', subtitle: 'fileManager.saveToSub' },
  lock: { icon: 'lock', title: 'lightFileActions.lockFile' },
  checksum: { icon: 'shield-check', title: 'lightFileActions.verifyChecksum', subtitle: 'lightFileActions.sha256' },
  'open-with': { icon: 'external-link', title: 'library.openWith' },
  rename: { icon: 'pencil', title: 'common.rename' },
  // A plain row: design 45 draws a switch on Delete by mistake.
  delete: { icon: 'trash-2', title: 'common.delete' },
};

/**
 * Design 45 for Files (Files F3): one sheet of actions for a file, opened from ⋮ on its row. In the design's order:
 * Play, Details, Show in folder, Share, Send to device, Save to…, Lock file, Verify checksum, Open with, Rename and
 * Delete; rows that can't apply are hidden (`fileActionsFor`). Every row runs the app's existing flow: the completed-file
 * share and Open with (with P8's malware warning), the native `copyToFolder` after Android's folder picker (nothing is
 * sent to any server), Move to Private, the H20 checksum, the existing rename (F5 replaces it) and the delete service,
 * which asks first unless F2's Confirm before delete is off.
 */
export const FileActionsSheet = memo(function FileActionsSheet({ file, onClose, onOpen, onChanged, testID = 'files-actions-sheet' }: FileActionsSheetProps) {
  const theme = useTheme();
  const insets = useSafeAreaInsets();
  const { height } = useWindowDimensions();
  const { t, language } = useTranslation();
  const [renameId, setRenameId] = useState<string | null>(null);
  const [confirmFile, setConfirmFile] = useState<FileEntry | null>(null);
  const [deleting, setDeleting] = useState(false);
  const privateMove = usePrivateMove(() => onChanged?.());
  useTourBlocker(file !== null);

  const actions = useMemo(
    () =>
      file
        ? fileActionsFor({
            type: file.type,
            missing: false,
            canLock: canMoveToPrivate(file.id),
            canSaveTo: getTreeExportPort() !== null,
            canChecksum: typeof fileIntegrity()?.computeChecksum === 'function',
          })
        : [],
    [file],
  );

  const runDelete = useCallback(
    async (target: FileEntry) => {
      setDeleting(true);
      try {
        const { deleteCompletedFileFromVidoraX } = await import('@/downloads/completed-file/delete/delete-service');
        const result = await deleteCompletedFileFromVidoraX(target.id);
        announce(result.ok ? t('fileManager.deleted') : t('fileManager.deleteFailed'));
        if (result.ok) onChanged?.();
      } catch {
        announce(t('fileManager.deleteFailed'));
      } finally {
        setDeleting(false);
        setConfirmFile(null);
      }
    },
    [onChanged, t],
  );

  const saveTo = useCallback(
    async (target: FileEntry) => {
      const port = getTreeExportPort();
      if (!port || !(await confirmLibraryFileAction(target.id, 'save', target.name))) {
        return;
      }
      const treeUri = await pickTreeFolder();
      if (!treeUri) {
        return;
      }
      announce(t('fileManager.saveToCopying'));
      try {
        await port.copyToFolder(target.id, treeUri, []);
        const folder = (await port.getFolderName(treeUri).catch(() => null)) ?? '';
        announce(t('fileManager.saveToDone', { folder }));
      } catch {
        announce(t('fileManager.saveToFailed'));
      }
    },
    [t],
  );

  const shareFile = useCallback(
    async (target: FileEntry) => {
      try {
        const { shareCompletedFile } = await import('@/downloads/completed-file/action-service');
        const result = await shareCompletedFile(target.id);
        if (!result.ok) announce(t(completedActionErrorMessageKey(result.error.code) as TranslationKey));
      } catch {
        announce(t('files.shareFailed'));
      }
    },
    [t],
  );

  const openWith = useCallback(
    async (target: FileEntry) => {
      try {
        const { openCompletedFile } = await import('@/downloads/completed-file/action-service');
        const result = await openCompletedFile(target.id);
        if (!result.ok) announce(t(completedActionErrorMessageKey(result.error.code) as TranslationKey));
      } catch {
        announce(t('files.openFailed'));
      }
    },
    [t],
  );

  const run = useCallback(
    (action: FileAction, target: FileEntry) => {
      onClose();
      switch (action) {
        case 'play':
          onOpen(target);
          return;
        case 'details':
          navigation.push(fileDetailsPath(target.id));
          return;
        case 'show-in-folder':
          // The folder it is in (the type's list when it is in none), with its row highlighted.
          if (target.folderId) {
            navigation.push(`${filesFolderPath(target.folderId)}?highlight=${encodeURIComponent(target.id)}`);
          } else if (target.type !== 'other') {
            navigation.push(`${filesTypePath(target.type)}?highlight=${encodeURIComponent(target.id)}`);
          } else {
            navigation.navigate(routePaths.files);
          }
          return;
        case 'share':
        case 'send-to-device':
          // Send to device is the same share sheet; Quick Share and nearby devices are listed there.
          void shareFile(target);
          return;
        case 'save-to':
          void saveTo(target);
          return;
        case 'lock':
          void privateMove.request(target.id);
          return;
        case 'checksum':
          navigation.push(fileChecksumPath(target.id));
          return;
        case 'open-with':
          void openWith(target);
          return;
        case 'rename':
          setRenameId(target.id);
          return;
        case 'delete':
          if (isConfirmBeforeDeleteOn()) {
            setConfirmFile(target);
          } else {
            void runDelete(target);
          }
          return;
        default:
          return;
      }
    },
    [onClose, onOpen, openWith, privateMove, runDelete, saveTo, shareFile],
  );

  return (
    <>
      <Modal visible={file !== null} transparent animationType="fade" onRequestClose={onClose} statusBarTranslucent>
        <View style={{ flex: 1, justifyContent: 'flex-end', backgroundColor: theme.colors.overlay }}>
          <RNPressable
            style={{ position: 'absolute', top: 0, left: 0, right: 0, bottom: 0 }}
            accessibilityRole="button"
            accessibilityLabel={t('common.dismiss')}
            onPress={onClose}
          />
          <View
            testID={testID}
            style={{
              backgroundColor: theme.colors.background,
              borderTopLeftRadius: 20,
              borderTopRightRadius: 20,
              paddingTop: 10,
              paddingHorizontal: ds.space.screenX,
              paddingBottom: insets.bottom + 12,
              maxHeight: height * 0.85,
            }}>
            <View style={{ alignSelf: 'center', width: 36, height: 4, borderRadius: 2, backgroundColor: theme.colors.divider, marginBottom: 10 }} />
            {file ? (
              <View accessibilityRole="header" style={{ marginBottom: 10, gap: 2 }}>
                <DsText variant="cardTitle" numberOfLines={2}>
                  {file.name}
                </DsText>
                <DsText variant="rowSub" numberOfLines={1}>
                  {fileMetaLine(file, intlLocaleForLanguage(language))}
                </DsText>
              </View>
            ) : null}
            <ScrollView showsVerticalScrollIndicator={false}>
              <DsRowGroup>
                {file
                  ? actions.map((action) => {
                      const row = ROWS[action];
                      return (
                        <DsRow
                          key={action}
                          icon={row.icon}
                          title={t(row.title)}
                          subtitle={row.subtitle ? t(row.subtitle) : undefined}
                          trailing="none"
                          onPress={() => run(action, file)}
                          testID={`${testID}-${action}`}
                        />
                      );
                    })
                  : null}
              </DsRowGroup>
            </ScrollView>
          </View>
        </View>
      </Modal>

      <RenameModal
        visible={renameId !== null}
        id={renameId ?? ''}
        onClose={() => {
          setRenameId(null);
          onChanged?.();
        }}
      />
      <ConfirmModal
        visible={confirmFile !== null}
        variant="delete"
        title={t('library.deleteTitle')}
        message={t('library.deleteMessage')}
        confirmLabel={t('library.deleteConfirm')}
        cancelLabel={t('library.deleteCancel')}
        loading={deleting}
        onConfirm={() => {
          if (confirmFile) void runDelete(confirmFile);
        }}
        onCancel={() => {
          if (!deleting) setConfirmFile(null);
        }}
        testID={`${testID}-delete`}
      />
      <PrivateMoveDialog controller={privateMove} testID={`${testID}-private-move`} />
    </>
  );
});
