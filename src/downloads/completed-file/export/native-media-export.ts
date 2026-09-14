/**
 * Native bridge for Phase 7C MediaStore / SAF export.
 */

import { NativeModules, Platform } from 'react-native';

import { CompletedFileExportError } from './errors';

type NativeExportResult = {
  contentUri: string;
  displayName: string;
  bytesCopied: number;
  strategy: 'mediastore' | 'saf' | string;
};

type VidoraMediaExportNative = {
  getSdkInt: () => Promise<number>;
  mediaStoreUriExists: (contentUri: string) => Promise<boolean>;
  deletePendingMediaStoreUri: (contentUri: string) => Promise<boolean>;
  exportManagedFile: (
    absolutePath: string,
    downloadId: string,
    displayName: string,
    mimeType: string,
    collection: string,
    relativePath: string,
  ) => Promise<NativeExportResult>;
};

function getNative(): VidoraMediaExportNative | null {
  if (Platform.OS !== 'android') {
    return null;
  }
  const mod = NativeModules.VidoraMediaExport as VidoraMediaExportNative | undefined;
  if (!mod || typeof mod.exportManagedFile !== 'function') {
    return null;
  }
  return mod;
}

export function isAndroidMediaExportNativeAvailable(): boolean {
  return getNative() != null;
}

export async function nativeGetSdkInt(): Promise<number> {
  const native = getNative();
  if (!native?.getSdkInt) {
    return 0;
  }
  try {
    return Number(await native.getSdkInt()) || 0;
  } catch {
    return 0;
  }
}

export async function nativeMediaStoreUriExists(
  contentUri: string,
): Promise<boolean> {
  const native = getNative();
  if (!native?.mediaStoreUriExists) {
    return false;
  }
  try {
    return Boolean(await native.mediaStoreUriExists(contentUri));
  } catch {
    return false;
  }
}

export async function nativeDeletePendingMediaStoreUri(
  contentUri: string,
): Promise<boolean> {
  const native = getNative();
  if (!native?.deletePendingMediaStoreUri) {
    return false;
  }
  try {
    return Boolean(await native.deletePendingMediaStoreUri(contentUri));
  } catch {
    return false;
  }
}

export async function nativeExportManagedFile(input: {
  absolutePath: string;
  downloadId: string;
  displayName: string;
  mimeType: string;
  collection: string;
  relativePath: string;
}): Promise<NativeExportResult> {
  const native = getNative();
  if (!native) {
    throw new CompletedFileExportError('NATIVE_UNAVAILABLE');
  }
  try {
    return await native.exportManagedFile(
      input.absolutePath,
      input.downloadId,
      input.displayName,
      input.mimeType,
      input.collection,
      input.relativePath,
    );
  } catch (error) {
    const code =
      typeof error === 'object' &&
      error != null &&
      'code' in error &&
      typeof (error as { code: unknown }).code === 'string'
        ? (error as { code: string }).code
        : 'COPY_IO_FAILED';
    throw new CompletedFileExportError(
      mapNativeCode(code),
      code === 'LEGACY_EXPORT_CANCELLED' ? 'Save cancelled' : undefined,
    );
  }
}

function mapNativeCode(code: string): import('./errors').CompletedFileExportErrorCode {
  switch (code) {
    case 'FILE_MISSING':
    case 'INVALID_MANAGED_PATH':
    case 'UNSUPPORTED_EXPORT_DESTINATION':
    case 'MEDIASTORE_INSERT_FAILED':
    case 'OUTPUT_STREAM_UNAVAILABLE':
    case 'COPY_IO_FAILED':
    case 'INSUFFICIENT_STORAGE':
    case 'COPY_SIZE_MISMATCH':
    case 'MEDIASTORE_PUBLISH_FAILED':
    case 'LEGACY_EXPORT_CANCELLED':
    case 'LEGACY_EXPORT_FAILED':
    case 'NATIVE_UNAVAILABLE':
      return code;
    default:
      return 'COPY_IO_FAILED';
  }
}
