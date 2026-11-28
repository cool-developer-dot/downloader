import { useLocalSearchParams } from 'expo-router';
import { memo, useCallback, useState } from 'react';

import { AppModal } from '@/components/modals/AppModal';
import { DsHeader, DsRow, DsRowGroup, DsScreen } from '@/design';
import { canSaveCopyAs } from '@/downloads/cloud/cloud-port';
import { completedActionErrorMessageKey } from '@/downloads/completed-file/action-errors';
import { fileIntegrity } from '@/downloads/v2/file-integrity';
import { showInFolderTarget } from '@/downloads/v2/save-location';
import { useExternalCopiesStore } from '@/downloads/v2/save-location-store';
import { showItemInFolder } from '@/downloads/v2/show-in-folder';
import { useTranslation, type TranslationKey } from '@/localization';
import { navigation, openPlayer } from '@/navigation';
import { canMoveToPrivate } from '@/private-vault/move-to-private.runtime';
import { isRemoteControlAvailable, sendToComputer } from '@/remote/remote-control';
import { DownloadCloudSaveAction } from '@/screens/downloads/components/DownloadCloudSaveAction';
import { DownloadDeleteDialog } from '@/screens/downloads/components/DownloadDeleteDialog';
import { requestDelete as requestFilesDelete } from '@/files/trash/useDeleteWithUndo';
import { downloadsDeleteRoute, wasDeleted } from '@/files/ui/delete-door';
import { isConfirmBeforeDeleteOn } from '@/files/ui/files-view-settings';
import { DownloadIntegritySection } from '@/screens/downloads/components/DownloadIntegritySection';
import { PrivateMoveDialog } from '@/screens/private/PrivateMoveDialog';
import { usePrivateMove } from '@/screens/private/usePrivateMove';
import { useDownloadsStore } from '@/store/downloads';

import { toast } from '../shared/toast';
import { useNotYet } from '../shared/use-not-yet';
import { useSettingsHeaderAction } from '../shared/use-settings-header-action';

import { RenameModal } from './RenameModal';

function resolveIdParam(raw: string | string[] | undefined): string {
  const value = Array.isArray(raw) ? raw[0] : raw;
  if (typeof value !== 'string' || !value.trim()) {
    return '';
  }
  try {
    return decodeURIComponent(value.trim());
  } catch {
    return value.trim();
  }
}

/**
 * Design 45 "File actions" for one download (`?id=`): the completed-file actions Download details offers — Play,
 * Show in folder (#398), Share, Lock file (Move to Private #459), Verify checksum (H20 #409), Rename, Delete — plus
 * the rows whose feature does not exist yet (Send to device, Save to cloud).
 */
export const FileActionsScreen = memo(function FileActionsScreen() {
  const { t } = useTranslation();
  const notYet = useNotYet();
  const settingsAction = useSettingsHeaderAction();
  const params = useLocalSearchParams<{ id?: string | string[] }>();
  const id = resolveIdParam(params.id);
  const item = useDownloadsStore((s) => (id ? (s.engineRowsById[id] ?? s.itemsById[id] ?? null) : null));
  const completed = item?.status === 'COMPLETED';
  const [checksumOpen, setChecksumOpen] = useState(false);
  const [cloudOpen, setCloudOpen] = useState(false);
  const [renameOpen, setRenameOpen] = useState(false);
  const [deleteOpen, setDeleteOpen] = useState(false);
  const [deleting, setDeleting] = useState(false);
  const onMoved = useCallback(() => navigation.back(), []);
  const privateMove = usePrivateMove(onMoved);

  const requireCompleted = useCallback((): boolean => {
    if (!item) {
      toast(t('lightFileActions.missing'));
      return false;
    }
    if (!completed) {
      toast(t('lightFileActions.notCompleted'));
      return false;
    }
    return true;
  }, [completed, item, t]);

  const play = useCallback(() => {
    if (requireCompleted()) {
      openPlayer(id);
    }
  }, [id, requireCompleted]);

  const showInFolder = useCallback(() => {
    if (!requireCompleted()) {
      return;
    }
    if (!showInFolderTarget(useExternalCopiesStore.getState().records[id])) {
      toast(t('lightFileActions.noFolderCopy'));
      return;
    }
    void showItemInFolder(id);
  }, [id, requireCompleted, t]);

  const share = useCallback(async () => {
    if (!requireCompleted()) {
      return;
    }
    try {
      const { shareCompletedFile } = await import('@/downloads/completed-file/action-service');
      const result = await shareCompletedFile(id);
      if (!result.ok) {
        toast(t(completedActionErrorMessageKey(result.error.code) as TranslationKey));
      }
    } catch {
      toast(t('files.unavailable'));
    }
  }, [id, requireCompleted, t]);

  const lock = useCallback(() => {
    if (!requireCompleted()) {
      return;
    }
    if (!canMoveToPrivate(id)) {
      notYet();
      return;
    }
    void privateMove.request(id);
  }, [id, notYet, privateMove, requireCompleted]);

  const verify = useCallback(() => {
    if (!requireCompleted()) {
      return;
    }
    if (!fileIntegrity()) {
      toast(t('fileIntegrity.unavailable'));
      return;
    }
    setChecksumOpen(true);
  }, [requireCompleted, t]);

  const confirmDelete = useCallback(async () => {
    setDeleting(true);
    try {
      const ok = await useDownloadsStore.getState().remove(id);
      setDeleteOpen(false);
      if (ok) {
        navigation.back();
      }
    } catch {
      setDeleteOpen(false);
    } finally {
      setDeleting(false);
    }
  }, [id]);

  const requestDelete = useCallback(() => {
    if (!item) {
      toast(t('lightFileActions.missing'));
      return;
    }
    // Files F8 (Faran, 2026-11-28): a finished download's file goes through the door into the Recycle bin, with F2's
    // Confirm before delete and Undo, like every other delete.
    if (downloadsDeleteRoute(item.status) === 'door') {
      requestFilesDelete({
        ids: [id],
        source: 'downloads',
        name: item.title || item.fileName || undefined,
        onDone: (result) => {
          if (wasDeleted(result, id)) navigation.back();
        },
      });
      return;
    }
    // Files F2 #800: with Confirm before delete off, no "Delete from VidoraX?".
    if (!isConfirmBeforeDeleteOn()) {
      void confirmDelete();
      return;
    }
    setDeleteOpen(true);
  }, [confirmDelete, id, item, t]);

  // P6 #511: the video (and its page) to "Sent from phone" in the Web UI on the computer.
  const sendToDevice = useCallback(() => {
    if (!requireCompleted()) {
      return;
    }
    if (!isRemoteControlAvailable()) {
      notYet();
      return;
    }
    void sendToComputer({ url: item?.sourceUrl ?? null, title: item?.title || item?.fileName || id, downloadId: id });
  }, [id, item?.fileName, item?.sourceUrl, item?.title, notYet, requireCompleted]);

  // #512: Android's save screen, where the user's cloud apps appear.
  const openCloud = useCallback(() => {
    if (!requireCompleted()) {
      return;
    }
    if (!canSaveCopyAs()) {
      notYet();
      return;
    }
    setCloudOpen(true);
  }, [notYet, requireCompleted]);

  const subtitle = item?.fileName?.trim() || item?.title?.trim() || '—';

  return (
    <DsScreen testID="file-actions-screen">
      <DsHeader title={t('files.actionsTitle')} subtitle={subtitle} action={settingsAction} />
      <DsRowGroup testID="file-actions-rows">
        <DsRow icon="play" title={t('common.play')} onPress={play} testID="file-actions-play" />
        <DsRow icon="folder" title={t('saveLocation.showInFolder')} onPress={showInFolder} testID="file-actions-folder" />
        <DsRow icon="share-2" title={t('common.share')} onPress={() => void share()} testID="file-actions-share" />
        <DsRow icon="smartphone" title={t('lightFileActions.sendToDevice')} subtitle={t('remoteControl.sendToComputer')} onPress={sendToDevice} testID="file-actions-device" />
        <DsRow icon="cloud" title={t('lightFileActions.saveToCloud')} onPress={openCloud} testID="file-actions-cloud" />
        <DsRow icon="lock" title={t('lightFileActions.lockFile')} onPress={lock} testID="file-actions-lock" />
        <DsRow icon="check" title={t('lightFileActions.verifyChecksum')} subtitle={t('lightFileActions.sha256')} onPress={verify} testID="file-actions-checksum" />
        <DsRow icon="pencil" title={t('common.rename')} onPress={() => (item ? setRenameOpen(true) : toast(t('lightFileActions.missing')))} testID="file-actions-rename" />
        <DsRow icon="trash-2" title={t('common.delete')} onPress={requestDelete} testID="file-actions-delete" />
      </DsRowGroup>

      <AppModal visible={cloudOpen} onClose={() => setCloudOpen(false)} title={t('lightFileActions.saveToCloud')} testID="file-actions-cloud-modal">
        <DownloadCloudSaveAction id={id} />
      </AppModal>
      <AppModal visible={checksumOpen} onClose={() => setChecksumOpen(false)} title={t('fileIntegrity.checksumTitle')} testID="file-actions-checksum-modal">
        <DownloadIntegritySection id={id} status="COMPLETED" />
      </AppModal>
      <RenameModal visible={renameOpen} id={id} onClose={() => setRenameOpen(false)} />
      <DownloadDeleteDialog
        visible={deleteOpen}
        loading={deleting}
        mode={completed ? 'remove' : 'delete'}
        onConfirm={() => void confirmDelete()}
        onCancel={() => setDeleteOpen(false)}
        testID="file-actions-delete-dialog"
      />
      <PrivateMoveDialog controller={privateMove} testID="file-actions-private-move" />
    </DsScreen>
  );
});
