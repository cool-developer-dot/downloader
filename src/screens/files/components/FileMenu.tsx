import { memo, useCallback, useMemo, useState } from 'react';

import type { ActionSheetItem } from '@/components/bottom-sheets/ActionSheet';
import { ActionSheetModal } from '@/components/bottom-sheets/ActionSheetModal';
import { ConfirmModal } from '@/components/modals/ConfirmModal';
import type { FileEntry } from '@/files/ui/files-index';
import { useTranslation } from '@/localization';

import { announce } from '../announce';
import { openFileDetails } from '../open-file';

export type FileMenuProps = {
  /** The file whose ⋮ was tapped; null when the menu is closed. */
  file: FileEntry | null;
  onClose: () => void;
  onOpen: (file: FileEntry) => void;
  /** After a delete: the list reloads. */
  onChanged?: () => void;
  testID?: string;
};

/**
 * Files F1: a file's ⋮ until F3's actions sheet (design 45) replaces it — Open, Details and Delete. Delete is the
 * app's own "Delete from VidoraX?" (the Player tab's dialog and its delete service).
 */
export const FileMenu = memo(function FileMenu({ file, onClose, onOpen, onChanged, testID = 'files-file-menu' }: FileMenuProps) {
  const { t } = useTranslation();
  const [confirmFile, setConfirmFile] = useState<FileEntry | null>(null);
  const [deleting, setDeleting] = useState(false);

  const runDelete = useCallback(
    async (target: FileEntry) => {
      setDeleting(true);
      try {
        const { deleteCompletedFileFromVidoraX } = await import('@/downloads/completed-file/delete/delete-service');
        const result = await deleteCompletedFileFromVidoraX(target.id);
        announce(result.ok ? t('fileManager.deleted') : t('fileManager.deleteFailed'));
        if (result.ok) {
          onChanged?.();
        }
      } catch {
        announce(t('fileManager.deleteFailed'));
      } finally {
        setDeleting(false);
        setConfirmFile(null);
      }
    },
    [onChanged, t],
  );

  const actions = useMemo<ActionSheetItem[]>(() => {
    if (!file) {
      return [];
    }
    return [
      {
        id: 'open',
        label: t('files.open'),
        onPress: () => {
          onClose();
          onOpen(file);
        },
      },
      {
        id: 'details',
        label: t('fileManager.details'),
        onPress: () => {
          onClose();
          openFileDetails(file.id);
        },
      },
      {
        id: 'delete',
        label: t('library.deleteFromVidoraX'),
        destructive: true,
        onPress: () => {
          onClose();
          setConfirmFile(file);
        },
      },
    ];
  }, [file, onClose, onOpen, t]);

  return (
    <>
      <ActionSheetModal visible={file !== null} onClose={onClose} title={file?.name} actions={actions} testID={testID} />
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
    </>
  );
});
