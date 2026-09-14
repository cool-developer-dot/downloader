/**
 * Local completed-file Open / Share.
 *
 * Android: Phase 7B native ACTION_VIEW / ACTION_SEND with content:// + read grant.
 * iOS Share keeps file:// URL via RN Share.
 *
 * Prefer downloadId-based APIs in completed-file/action-service.ts for new call sites.
 */

import { Platform, Share } from 'react-native';
import { File } from 'expo-file-system';

import { DownloadEngineError } from './errors';
import { verifyCompletedFile } from './file-paths';
import { mimeFromFileName } from './resource-guard';
import {
  isAndroidFileActionsNativeAvailable,
  nativeOpenContentUri,
  nativeShareContentUri,
} from '@/downloads/completed-file/native-file-actions';
import { resolveExternalHandoffMime } from '@/downloads/completed-file/uri-safety';

export function assertLocalFileAvailable(
  localUri: string | null | undefined,
  options?: { downloadId?: string; expectedBytes?: number | null },
): File {
  if (!localUri) {
    throw new DownloadEngineError(
      'PARTIAL_FILE_MISSING',
      'This file is not available on this device.',
    );
  }
  const file = new File(localUri);
  const verified = verifyCompletedFile(file, options?.expectedBytes ?? null, {
    downloadId: options?.downloadId,
  });
  if (!verified.ok) {
    throw new DownloadEngineError(
      verified.reason === 'missing' ? 'PARTIAL_FILE_MISSING' : 'FINAL_FILE_INVALID',
      verified.reason === 'missing'
        ? 'This file is missing from device storage.'
        : 'This file can’t be opened.',
    );
  }
  return file;
}

/** Android-safe URI for Share / Intent handoff; iOS keeps file://. */
function toExternalHandoffUri(file: File): string {
  if (Platform.OS === 'android') {
    return file.contentUri;
  }
  return file.uri;
}

export async function shareLocalDownload(
  localUri: string,
  fileName?: string,
  options?: {
    downloadId?: string;
    expectedBytes?: number | null;
    mimeType?: string | null;
    title?: string | null;
  },
): Promise<void> {
  const file = assertLocalFileAvailable(localUri, options);
  const title =
    options?.title?.trim() || fileName?.trim() || 'Downloaded file';
  const { intentMime } = resolveExternalHandoffMime(
    options?.mimeType ?? mimeFromFileName(fileName ?? file.name),
    fileName ?? file.name,
  );

  try {
    if (Platform.OS === 'android' && isAndroidFileActionsNativeAvailable()) {
      const contentUri = toExternalHandoffUri(file);
      await nativeShareContentUri(contentUri, intentMime, title);
      return;
    }

    if (Platform.OS === 'ios') {
      await Share.share({
        url: file.uri,
        title,
      });
      return;
    }

    // Android RN Share.share is text/plain-only and ignores `url` — never use it
    // for completed media (that produced filename-only WhatsApp/Telegram shares).
    throw new DownloadEngineError(
      'FILE_SYSTEM_ERROR',
      'Unable to share this video.',
    );
  } catch (error) {
    if (error instanceof DownloadEngineError) {
      throw error;
    }
    const message = error instanceof Error ? error.message.toLowerCase() : '';
    if (message.includes('cancel') || message.includes('dismiss')) {
      return;
    }
    const code =
      typeof error === 'object' &&
      error != null &&
      'code' in error &&
      typeof (error as { code: unknown }).code === 'string'
        ? (error as { code: string }).code
        : '';
    if (code === 'NO_COMPATIBLE_APP') {
      throw new DownloadEngineError(
        'FILE_SYSTEM_ERROR',
        'No app is available to share this file.',
      );
    }
    throw new DownloadEngineError(
      'FILE_SYSTEM_ERROR',
      'Unable to share this video.',
    );
  }
}

export async function openLocalDownload(
  localUri: string,
  options?: {
    downloadId?: string;
    expectedBytes?: number | null;
    mimeType?: string | null;
    fileName?: string | null;
  },
): Promise<void> {
  const file = assertLocalFileAvailable(localUri, options);
  const { intentMime } = resolveExternalHandoffMime(
    options?.mimeType ?? mimeFromFileName(options?.fileName ?? file.name),
    options?.fileName ?? file.name,
  );

  try {
    if (Platform.OS === 'android' && isAndroidFileActionsNativeAvailable()) {
      const contentUri = toExternalHandoffUri(file);
      await nativeOpenContentUri(contentUri, intentMime);
      return;
    }

    throw new DownloadEngineError(
      'FILE_SYSTEM_ERROR',
      'No app is available to open this file. Try Share instead.',
    );
  } catch (error) {
    if (error instanceof DownloadEngineError) {
      throw error;
    }
    const code =
      typeof error === 'object' &&
      error != null &&
      'code' in error &&
      typeof (error as { code: unknown }).code === 'string'
        ? (error as { code: string }).code
        : '';
    if (code === 'NO_COMPATIBLE_APP') {
      throw new DownloadEngineError(
        'FILE_SYSTEM_ERROR',
        'No app is available to open this file. Try Share instead.',
      );
    }
    throw new DownloadEngineError(
      'FILE_SYSTEM_ERROR',
      'No app is available to open this file. Try Share instead.',
    );
  }
}
