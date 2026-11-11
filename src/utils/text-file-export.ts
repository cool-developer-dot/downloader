import { Directory, File } from 'expo-file-system';
// A namespace import: Share is read only when the share sheet is actually used.
import * as ReactNative from 'react-native';

import { withExpectedSystemScreen } from '@/security/app-lock/expected-system-screen';

import {
  exportTextFileWith,
  importTextFileWith,
  type TextExportInput,
  type TextExportResult,
  type TextImportResult,
} from './text-file-export-core';

export type { TextExportInput, TextExportResult, TextImportResult };
export { exportFileName, MAX_IMPORT_BYTES } from './text-file-export-core';

/**
 * Saves `content` as a file in a folder the user picks (system folder picker, no storage permission); falls back
 * to the share sheet when that is not possible. Shared by download history, queue backup and settings backup. The
 * picker and the share sheet are system screens of this action: App Lock does not relock for them.
 */
export function exportTextFile(input: TextExportInput): Promise<TextExportResult> {
  return exportTextFileWith(
    {
      pickDirectory: () => withExpectedSystemScreen(() => Directory.pickDirectoryAsync()),
      writeFile: (directory, fileName, mimeType, content) => {
        const file = (directory as Directory).createFile(fileName, mimeType);
        file.write(content);
      },
      share: async (content, title) => {
        const { Share } = ReactNative;
        const result = await withExpectedSystemScreen(() => Share.share({ message: content, title }, { dialogTitle: title }));
        return result.action !== Share.dismissedAction;
      },
    },
    input,
  );
}

/** Opens the system file picker (App Lock does not relock for it) and reads the chosen text file (bounded). */
export function importTextFile(mimeTypes: string[]): Promise<TextImportResult> {
  return importTextFileWith({
    pickFile: async () => {
      const picked = await withExpectedSystemScreen(() => File.pickFileAsync({ mimeTypes }));
      if (picked.canceled || !picked.result) {
        return null;
      }
      const file = picked.result;
      return { size: typeof file.size === 'number' ? file.size : null, read: () => file.text() };
    },
  });
}
