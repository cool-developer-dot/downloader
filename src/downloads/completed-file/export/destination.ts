/**
 * Phase 7C — export destination / MIME collection policy (pure).
 */

export type ExportCollection =
  | 'video'
  | 'audio'
  | 'downloads';

export type ExportDestination = {
  collection: ExportCollection;
  /** MediaStore RELATIVE_PATH style (no leading slash). */
  relativePath: string;
  /** MIME used for insert — may be action-local fallback for unknown. */
  mimeType: string;
  /** Whether MIME is Phase 7A authoritative or action-local fallback. */
  mimeAuthoritative: boolean;
};

/**
 * Map Phase 7A MIME/container to a public MediaStore collection.
 * TS / unknown → Downloads (not fake Gallery MP4).
 */
export function resolveExportDestination(input: {
  mimeType: string | null | undefined;
  fileName?: string | null;
  container?: string | null;
}): ExportDestination {
  const mime = (input.mimeType ?? '').trim().toLowerCase();
  const ext = extensionOf(input.fileName);
  const container = (input.container ?? '').trim().toLowerCase();

  if (mime.startsWith('audio/') || isAudioExt(ext) || container === 'm4a') {
    return {
      collection: 'audio',
      relativePath: 'Music/VidoraX/',
      mimeType: mime && mime.includes('/') ? mime : 'audio/mpeg',
      mimeAuthoritative: Boolean(mime && mime.includes('/') && mime !== '*/*'),
    };
  }

  if (
    mime === 'video/mp2t' ||
    ext === 'ts' ||
    ext === 'm2ts' ||
    container === 'ts'
  ) {
    return {
      collection: 'downloads',
      relativePath: 'Download/VidoraX/',
      mimeType: mime === 'video/mp2t' ? 'video/mp2t' : mime || 'video/mp2t',
      mimeAuthoritative: mime === 'video/mp2t' || Boolean(mime && mime.includes('/')),
    };
  }

  if (mime.startsWith('video/') || isVideoExt(ext)) {
    const resolved =
      mime.startsWith('video/') && mime !== '*/*'
        ? mime
        : mimeFromExt(ext) ?? 'video/mp4';
    return {
      collection: 'video',
      relativePath: 'Movies/VidoraX/',
      mimeType: resolved,
      mimeAuthoritative: Boolean(mime.startsWith('video/') && mime !== '*/*'),
    };
  }

  // Unknown — Downloads with octet-stream action-local fallback (not persisted as 7A MIME).
  return {
    collection: 'downloads',
    relativePath: 'Download/VidoraX/',
    mimeType:
      mime && mime.includes('/') && mime !== '*/*'
        ? mime
        : 'application/octet-stream',
    mimeAuthoritative: Boolean(mime && mime.includes('/') && mime !== '*/*'),
  };
}

export function resolveExportCapability(input: {
  status: string | null | undefined;
  physicalFilePresent: boolean;
}): boolean {
  return (
    (input.status ?? '').toUpperCase() === 'COMPLETED' &&
    input.physicalFilePresent === true
  );
}

function extensionOf(fileName: string | null | undefined): string {
  if (!fileName?.trim()) {
    return '';
  }
  const base = fileName.trim().split(/[/\\]/).pop() ?? '';
  const dot = base.lastIndexOf('.');
  if (dot <= 0 || dot === base.length - 1) {
    return '';
  }
  return base.slice(dot + 1).toLowerCase();
}

function isVideoExt(ext: string): boolean {
  return ['mp4', 'm4v', 'webm', 'mkv', 'mov'].includes(ext);
}

function isAudioExt(ext: string): boolean {
  return ['m4a', 'mp3', 'aac', 'wav', 'ogg'].includes(ext);
}

function mimeFromExt(ext: string): string | null {
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
