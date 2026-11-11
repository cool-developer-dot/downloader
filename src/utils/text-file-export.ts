import { Directory, File } from 'expo-file-system';
// A namespace import: Share is read only when the share sheet is actually used.
import * as ReactNative from 'react-native';

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
 * to the share sheet when that is not possible. Shared by download history, queue backup and settings backup.
 */
export function exportTextFile(input: TextExportInput): Promise<TextExportResult> {
  return exportTextFileWith(
    {
      pickDirectory: () => Directory.pickDirectoryAsync(),
      writeFile: (directory, fileName, mimeType, content) => {
        const file = (directory as Directory).createFile(fileName, mimeType);
        file.write(content);
      },
      share: async (content, title) => {
        const { Share } = ReactNative;
        const result = await Share.share({ message: content, title }, { dialogTitle: title });
        return result.action !== Share.dismissedAction;
      },
    },
    input,
  );
}

/** Opens the system file picker and reads the chosen text file (bounded). */
export function importTextFile(mimeTypes: string[]): Promise<TextImportResult> {
  return importTextFileWith({
    pickFile: async () => {
      const picked = await File.pickFileAsync({ mimeTypes });
      if (picked.canceled || !picked.result) {
        return null;
      }
      const file = picked.result;
      return { size: typeof file.size === 'number' ? file.size : null, read: () => file.text() };
    },
  });
}
