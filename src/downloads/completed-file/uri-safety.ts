/**
 * Phase 7B — pure helpers for content URI / MIME / path validation.
 * No Expo FS imports — unit-testable in Node.
 */

export function isContentUri(uri: string | null | undefined): boolean {
  return typeof uri === 'string' && uri.trim().toLowerCase().startsWith('content://');
}

export function isRawFileUri(uri: string | null | undefined): boolean {
  return typeof uri === 'string' && uri.trim().toLowerCase().startsWith('file:');
}

/**
 * External handoff MIME: Phase 7A MIME first; never overwrite persisted MIME with star.
 * Last-resort intent fallback is returned separately for Intent construction only.
 */
export function resolveExternalHandoffMime(
  phase7aMime: string | null | undefined,
  fileName?: string | null,
): { mimeType: string | null; intentMime: string } {
  const trimmed =
    typeof phase7aMime === 'string' ? phase7aMime.trim().toLowerCase() : '';
  if (trimmed && /^[a-z0-9.+-]+\/[a-z0-9.+-]+$/.test(trimmed) && trimmed !== '*/*') {
    return { mimeType: trimmed, intentMime: trimmed };
  }

  const fromName = mimeFromSafeExtension(fileName);
  if (fromName) {
    return { mimeType: fromName, intentMime: fromName };
  }

  return { mimeType: null, intentMime: '*/*' };
}

function mimeFromSafeExtension(fileName: string | null | undefined): string | null {
  if (!fileName?.trim()) {
    return null;
  }
  const dot = fileName.lastIndexOf('.');
  if (dot <= 0 || dot === fileName.length - 1) {
    return null;
  }
  const ext = fileName.slice(dot + 1).toLowerCase();
  switch (ext) {
    case 'mp4':
    case 'm4v':
      return 'video/mp4';
    case 'webm':
      return 'video/webm';
    case 'ts':
    case 'm2ts':
      return 'video/mp2t';
    case 'm4a':
      return 'audio/mp4';
    case 'mp3':
      return 'audio/mpeg';
    default:
      return null;
  }
}

/**
 * Reject caller-supplied absolute / traversal paths. Prefer downloadId resolution.
 */
export function isUnsafeCallerPath(pathOrUri: string | null | undefined): boolean {
  if (!pathOrUri?.trim()) {
    return true;
  }
  const value = pathOrUri.trim();
  if (value.includes('..')) {
    return true;
  }
  if (value.startsWith('/') && !value.startsWith('/data/')) {
    // Absolute non-managed paths are rejected at this pure layer;
    // managed validation still requires assertManagedDownloadPath at runtime.
    return true;
  }
  if (/^[a-zA-Z]:\\/.test(value)) {
    return true;
  }
  return false;
}

export function validateExternalContentUri(uri: string): boolean {
  return isContentUri(uri) && !isRawFileUri(uri);
}

/** Expo FileSystem FileProvider authority: `${applicationId}.FileSystemFileProvider`. */
export const VIDORAX_EXPO_FILE_PROVIDER_AUTHORITY_SUFFIX =
  '.FileSystemFileProvider';

export const DEFAULT_VIDORAX_PACKAGE_ID = 'com.anonymous.vidorax';

/**
 * True only for VidoraX Expo FileSystem FileProvider content URIs.
 * Rejects MediaStore and arbitrary third-party content:// authorities.
 */
export function isVidoraExpoFileProviderUri(
  uri: string | null | undefined,
  packageId: string = DEFAULT_VIDORAX_PACKAGE_ID,
): boolean {
  if (!isContentUri(uri) || isRawFileUri(uri)) {
    return false;
  }
  const trimmed = uri!.trim();
  const withoutScheme = trimmed.slice('content://'.length);
  const authority = withoutScheme.split('/')[0]?.split('?')[0] ?? '';
  if (!authority) {
    return false;
  }
  const expected = `${packageId}${VIDORAX_EXPO_FILE_PROVIDER_AUTHORITY_SUFFIX}`;
  return authority === expected;
}
