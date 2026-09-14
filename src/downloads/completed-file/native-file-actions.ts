/**
 * Native bridge for Android completed-file Open / Share.
 * Never logs content URIs (may encode managed paths).
 *
 * Defense in depth: only Expo FileSystem FileProvider URIs are forwarded.
 * Callers must still resolve downloadId → managed path → File.contentUri.
 */

import { NativeModules, Platform } from 'react-native';

import { isVidoraExpoFileProviderUri } from './uri-safety';

type VidoraFileActionsNative = {
  openContentUri: (contentUri: string, mimeType: string | null) => Promise<boolean>;
  shareContentUri: (
    contentUri: string,
    mimeType: string | null,
    title: string | null,
  ) => Promise<boolean>;
  canOpenContentUri: (contentUri: string, mimeType: string | null) => Promise<boolean>;
};

function getNative(): VidoraFileActionsNative | null {
  if (Platform.OS !== 'android') {
    return null;
  }
  const mod = NativeModules.VidoraFileActions as VidoraFileActionsNative | undefined;
  if (
    !mod ||
    typeof mod.openContentUri !== 'function' ||
    typeof mod.shareContentUri !== 'function'
  ) {
    return null;
  }
  return mod;
}

function assertTrustedProviderUri(contentUri: string): void {
  if (!isVidoraExpoFileProviderUri(contentUri)) {
    throw new Error('URI_CREATION_FAILED');
  }
}

export function isAndroidFileActionsNativeAvailable(): boolean {
  return getNative() != null;
}

export async function nativeOpenContentUri(
  contentUri: string,
  mimeType: string | null,
): Promise<void> {
  const native = getNative();
  if (!native) {
    throw new Error('OPEN_FAILED');
  }
  assertTrustedProviderUri(contentUri);
  await native.openContentUri(contentUri, mimeType);
}

export async function nativeShareContentUri(
  contentUri: string,
  mimeType: string | null,
  title: string | null,
): Promise<void> {
  const native = getNative();
  if (!native) {
    throw new Error('SHARE_FAILED');
  }
  assertTrustedProviderUri(contentUri);
  await native.shareContentUri(contentUri, mimeType, title);
}

export async function nativeCanOpenContentUri(
  contentUri: string,
  mimeType: string | null,
): Promise<boolean> {
  const native = getNative();
  if (!native || typeof native.canOpenContentUri !== 'function') {
    return false;
  }
  if (!isVidoraExpoFileProviderUri(contentUri)) {
    return false;
  }
  try {
    return Boolean(await native.canOpenContentUri(contentUri, mimeType));
  } catch {
    return false;
  }
}
