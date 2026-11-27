import { useMemo } from 'react';

import { useItemHiddenStore } from '@/library/item-organize-store';
import { useTranslation } from '@/localization';
import { navigation, routePaths } from '@/navigation';

import { announce } from '../announce';
import type { MoreAction, SelectedEntry } from '../components/SelectionBar';
import { openSelectionDialog } from '../components/SelectionMoreHost';

function idsOf(entries: readonly SelectedEntry[]) {
  return {
    fileIds: entries.flatMap((entry) => (entry.kind === 'file' ? [entry.file.id] : [])),
    folderIds: entries.flatMap((entry) => (entry.kind === 'folder' ? [entry.folder.id] : [])),
  };
}

/**
 * Files F4: what the selection bar's More ⋮ holds, one block per package — F5 Rename (the batch rename page for the
 * selected files); F7 Tag (a tag, with its colour, on every selected file), Color (the selected folders' icons) and
 * Hide (the selected files; not encryption — Private is the lock).
 */
export function useSelectionMoreActions(): MoreAction[] {
  const { t } = useTranslation();
  return useMemo<MoreAction[]>(
    () => [
      // F5 #793: rename the selected files at once.
      {
        id: 'rename',
        label: t('common.rename'),
        onPress: (entries) => {
          const ids = entries.flatMap((entry) => (entry.kind === 'file' ? [entry.file.id] : []));
          if (ids.length > 0) {
            navigation.push(`${routePaths.filesBatchRename}?ids=${encodeURIComponent(ids.join(','))}`);
          }
        },
      },
      // F7 #939 / #977: one tag (and its colour) on every selected file.
      {
        id: 'tag',
        label: t('fileManager.addTag'),
        onPress: (entries, done) => {
          const { fileIds, folderIds } = idsOf(entries);
          if (fileIds.length > 0) openSelectionDialog({ kind: 'tag', fileIds, folderIds, done });
        },
      },
      // F7 #778: the selected folders' icon colour.
      {
        id: 'color',
        label: t('fileManager.folderColor'),
        onPress: (entries, done) => {
          const { fileIds, folderIds } = idsOf(entries);
          if (folderIds.length > 0) openSelectionDialog({ kind: 'color', fileIds, folderIds, done });
        },
      },
      // F7 #911: hide the selected files.
      {
        id: 'hide',
        label: t('fileManager.hide'),
        onPress: (entries, done) => {
          const { fileIds } = idsOf(entries);
          if (fileIds.length === 0) return;
          useItemHiddenStore.getState().setHidden(fileIds, true);
          announce(t('fileManager.hiddenCount', { count: fileIds.length }));
          done();
        },
      },
    ],
    [t],
  );
}
