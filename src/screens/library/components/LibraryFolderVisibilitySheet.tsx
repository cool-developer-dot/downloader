import { memo } from 'react';

import { DsRow, DsRowGroup } from '@/design';
import { UNFILED_FOLDER_SELECTION_ID } from '@/library/constants';
import { isFolderExcluded } from '@/library/folder-exclusion';
import { setLibraryFolderHidden } from '@/library/library-stats-store';
import { useTranslation } from '@/localization';
import { PlayerSheetFrame } from '@/screens/player/page/PlayerSheetFrame';

export type LibraryFolderVisibilitySheetProps = {
  visible: boolean;
  /** The library's folders, in the Folder filter's order. */
  folders: readonly { id: string; name: string }[];
  excludedFolderIds: readonly string[];
  onClose: () => void;
};

/**
 * P9 #628 Include / exclude folders (Library → Filter → Include / exclude folders; screen 18 has the row). One switch
 * per folder, "Unfiled / Downloads" first: on = shown in the Library. Changes apply at once and are remembered. Hiding
 * never deletes or moves a video.
 */
export const LibraryFolderVisibilitySheet = memo(function LibraryFolderVisibilitySheet({
  visible,
  folders,
  excludedFolderIds,
  onClose,
}: LibraryFolderVisibilitySheetProps) {
  const { t } = useTranslation();
  const rows = [{ id: UNFILED_FOLDER_SELECTION_ID, name: t('libraryStats.foldersUnfiled') }, ...folders];
  return (
    <PlayerSheetFrame
      visible={visible}
      title={t('libraryStats.foldersTitle')}
      subtitle={t('libraryStats.foldersSubtitle')}
      onClose={onClose}
      testID="library-folder-visibility">
      <DsRowGroup>
        {rows.map((folder) => {
          const shown = !isFolderExcluded(excludedFolderIds, folder.id);
          return (
            <DsRow
              key={folder.id}
              icon="folder"
              title={folder.name}
              subtitle={t(shown ? 'libraryStats.folderShown' : 'libraryStats.folderHidden')}
              toggle={{
                value: shown,
                onValueChange: (next) => setLibraryFolderHidden(folder.id, !next),
                accessibilityLabel: folder.name,
                accessibilityHint: t('libraryStats.foldersSubtitle'),
              }}
              testID={`library-folder-visibility-${folder.id}`}
            />
          );
        })}
      </DsRowGroup>
    </PlayerSheetFrame>
  );
});
