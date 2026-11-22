/**
 * P3: subtitle files on the device (expo-file-system; no new permission, no network).
 *
 * - #589 Load: the system file picker (the one the app already uses; App Lock does not relock for it). The chosen
 *   file's bytes are copied into VidoraX's own storage (`<documents>/subtitles/`), because a picked `content://` link
 *   does not survive a restart, and so a different encoding can be chosen later.
 * - #590 Auto detect: the files next to a library download (`<documents>/library/<site>/`), which VidoraX owns. Videos
 *   from the phone's gallery or opened from another app live in folders VidoraX cannot list without a storage
 *   permission, so nothing is looked for there.
 */

import { Directory, File, Paths } from 'expo-file-system';

import { isUriInside } from '@/downloads/engine/path-guard';
import { isV2LibraryFileUri } from '@/downloads/v2/library-files';
import { withExpectedSystemScreen } from '@/security/app-lock/expected-system-screen';

import { detectSubtitleFormat, parseSubtitles, SUBTITLE_EXTENSIONS } from './parse-subtitles';
import { decodeSubtitleBytes } from './subtitle-encoding';
import type { SubtitleFileRef } from './subtitle-record';

/** Bigger files are refused: a feature-length subtitle is well under 1 MB. */
export const MAX_SUBTITLE_BYTES = 5 * 1024 * 1024;

function copiesDirectory(): Directory {
  return new Directory(Paths.document, 'subtitles');
}

export type SubtitlePickOutcome =
  | { kind: 'picked'; ref: SubtitleFileRef }
  | { kind: 'canceled' }
  | { kind: 'too_big' }
  | { kind: 'not_subtitle' }
  | { kind: 'failed' };

function safeName(name: string): string {
  return name.replace(/[^A-Za-z0-9._-]+/g, '_').slice(-80) || 'subtitle';
}

/** #589: lets the user pick a subtitle file, checks it reads as one, and keeps a copy. */
export async function pickSubtitleFile(): Promise<SubtitlePickOutcome> {
  let picked: File;
  try {
    // Any type: phones label .srt / .ass files inconsistently (application/x-subrip, text/plain, octet-stream …).
    const result = await withExpectedSystemScreen(() => File.pickFileAsync({ mimeTypes: ['*/*'] }));
    if (result.canceled || !result.result) {
      return { kind: 'canceled' };
    }
    picked = result.result;
  } catch {
    return { kind: 'failed' };
  }
  try {
    if (typeof picked.size === 'number' && picked.size > MAX_SUBTITLE_BYTES) {
      return { kind: 'too_big' };
    }
    const bytes = await picked.bytes();
    if (bytes.length > MAX_SUBTITLE_BYTES) {
      return { kind: 'too_big' };
    }
    const name = picked.name || 'subtitle';
    const decoded = decodeSubtitleBytes(bytes, 'auto');
    const format = detectSubtitleFormat(name, decoded.text);
    if (!format || parseSubtitles(decoded.text, format).cues.length === 0) {
      return { kind: 'not_subtitle' };
    }
    const directory = copiesDirectory();
    if (!directory.exists) {
      directory.create({ intermediates: true });
    }
    const stamp = `${Date.now().toString(36)}${Math.random().toString(36).slice(2, 6)}`;
    const extension = Object.keys(SUBTITLE_EXTENSIONS).includes(name.split('.').pop()?.toLowerCase() ?? '')
      ? name.split('.').pop()!.toLowerCase()
      : format;
    const copy = directory.createFile(`${stamp}-${safeName(name.replace(/\.[^.]*$/, ''))}.${extension}`, null);
    copy.write(bytes);
    return {
      kind: 'picked',
      ref: {
        id: `picked:${stamp}`,
        name,
        uri: copy.uri,
        format,
        language: languageFromName(name),
        encoding: 'auto',
        origin: 'picked',
      },
    };
  } catch {
    return { kind: 'failed' };
  }
}

/** `movie.ur.srt` → `ur`; null when the name carries no language tag. */
function languageFromName(name: string): string | null {
  const parts = name.split('.');
  if (parts.length < 3) {
    return null;
  }
  const tag = parts[parts.length - 2]!;
  return /^[a-z]{2,3}(?:-[a-z0-9]{2,8})*$/i.test(tag) && tag.toLowerCase() !== 'und' ? tag : null;
}

export async function readSubtitleBytes(uri: string): Promise<Uint8Array> {
  const file = new File(uri);
  if (typeof file.size === 'number' && file.size > MAX_SUBTITLE_BYTES) {
    throw new Error('subtitle_too_big');
  }
  return file.bytes();
}

/** #590: the names of the files next to a library download, and where they are; null for any other video. */
export function listSidecarFiles(videoUri: string | null | undefined): { videoName: string; files: { name: string; uri: string }[] } | null {
  if (!videoUri || !isV2LibraryFileUri(videoUri)) {
    return null;
  }
  try {
    const video = new File(videoUri);
    const files: { name: string; uri: string }[] = [];
    for (const entry of video.parentDirectory.list()) {
      if (entry instanceof File && entry.uri !== video.uri) {
        files.push({ name: entry.name, uri: entry.uri });
      }
    }
    return { videoName: video.name, files };
  } catch {
    return null;
  }
}

/** Deletes VidoraX's own copies of loaded files (never a file next to a video). */
export function deleteSubtitleCopies(refs: readonly SubtitleFileRef[]): void {
  let root: string;
  try {
    root = copiesDirectory().uri;
  } catch {
    return;
  }
  for (const ref of refs) {
    if (ref.origin !== 'picked') continue;
    try {
      if (!isUriInside(root, ref.uri)) continue;
      const file = new File(ref.uri);
      if (file.exists) file.delete();
    } catch {
      // Already gone, or storage unavailable: nothing to do.
    }
  }
}
