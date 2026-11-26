/**
 * Files F1: the folder store's own errors in the F12 contract's codes (until Faran's engine throws them itself). Pure.
 * The folder repository says "A folder with this name already exists" for a taken name and "Folder name is required"
 * for an empty one; anything else is passed on unchanged.
 */

import { FilesError } from '@/files/api';

export function filesErrorFromFolderStore(cause: unknown): unknown {
  const message = cause instanceof Error ? cause.message : '';
  if (/already exists/i.test(message)) {
    return new FilesError('NAME_TAKEN', message);
  }
  if (/required/i.test(message)) {
    return new FilesError('INVALID_NAME', message);
  }
  return cause;
}
