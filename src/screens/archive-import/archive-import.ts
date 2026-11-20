/**
 * P8 #407 Extract Archive: what the archive screen says about a `.zip` another app opened in VidoraX. The native
 * module lists and extracts it (`ArchiveImport.kt`, `ZipArchive.kt`); this maps its answers to the screen's words.
 * Pure.
 */

import type { ArchiveRefusal, IncomingMedia } from '@modules/vidorax-media/src/VidoraMedia.types';
import type { TranslationKey } from '@/localization/types';

export const REFUSAL_KEYS: Record<ArchiveRefusal, TranslationKey> = {
  not_zip: 'archiveImport.refusedNotZip',
  rar: 'archiveImport.refusedRarSevenZip',
  seven_z: 'archiveImport.refusedRarSevenZip',
  encrypted: 'archiveImport.refusedEncrypted',
  path_escape: 'archiveImport.refusedPathEscape',
  too_many_entries: 'archiveImport.refusedTooManyEntries',
  too_large: 'archiveImport.refusedTooLarge',
  compression_ratio: 'archiveImport.refusedCompressionRatio',
  damaged: 'archiveImport.refusedDamaged',
  android_app: 'archiveImport.refusedAndroidApp',
};

/** The refusals that mean the archive was built to do harm: shown as a warning, not a plain error. */
export const MALICIOUS_REFUSALS: ReadonlySet<ArchiveRefusal> = new Set([
  'path_escape',
  'compression_ratio',
  'too_many_entries',
  'android_app',
]);

export function refusalKey(reason: unknown): TranslationKey {
  return typeof reason === 'string' && reason in REFUSAL_KEYS
    ? REFUSAL_KEYS[reason as ArchiveRefusal]
    : 'archiveImport.refusedDamaged';
}

const RAR_OR_7Z_MIME = new Set([
  'application/vnd.rar',
  'application/x-rar-compressed',
  'application/x-rar',
  'application/x-7z-compressed',
]);

/** A RAR or 7z, known from how it arrived: "not supported" is said without copying it first. */
export function isUnsupportedArchive(media: Pick<IncomingMedia, 'mimeType' | 'displayName'> | null | undefined): boolean {
  if (!media) {
    return false;
  }
  if (media.mimeType && RAR_OR_7Z_MIME.has(media.mimeType.toLowerCase())) {
    return true;
  }
  return /\.(rar|7z)$/i.test(media.displayName ?? '');
}

/** Router path of the archive screen for an incoming token. */
export function archiveImportPath(token: string): `/archive-import?token=${string}` {
  return `/archive-import?token=${encodeURIComponent(token)}`;
}
