import { useCallback } from 'react';

import type { FileEntry } from '@/files/ui/files-index';
import { useTranslation } from '@/localization';

import { announce } from '../announce';
import { openFileEntry } from '../open-file';
import { playableQueue } from '../utils/open-target';

/** Files F1: tapping a file — open it (`openFileEntry`), and say so when nothing could. */
export function useOpenFile(shownFiles: readonly FileEntry[]) {
  const { t } = useTranslation();
  return useCallback(
    (file: FileEntry) => {
      void openFileEntry(file, playableQueue(shownFiles)).then((result) => {
        if (result === 'no-app') {
          announce(t('fileManager.noApp'));
        } else if (result === 'failed') {
          announce(t('files.openFailed'));
        }
      });
    },
    [shownFiles, t],
  );
}
