/**
 * P7 — playlist names: what the user types, the name an imported file gives, and the file name an export gets.
 * Pure (tested under Node).
 */

export const MAX_PLAYLIST_NAME_LENGTH = 80;

/** Code points, so an emoji or a combining mark is never cut in half. */
function clip(text: string, max: number): string {
  const chars = Array.from(text);
  return chars.length > max ? chars.slice(0, max).join('') : text;
}

/** Without control characters (a pasted line break, a tab): they become spaces. */
function withoutControls(text: string): string {
  let out = '';
  for (const ch of text) {
    const code = ch.codePointAt(0) ?? 0;
    out += code < 0x20 || code === 0x7f ? ' ' : ch;
  }
  return out;
}

/** Trimmed, inner runs of spaces made one, at most 80 characters; '' when nothing is left. */
export function normalizePlaylistName(raw: string): string {
  return clip(withoutControls(raw).replace(/\s+/g, ' ').trim(), MAX_PLAYLIST_NAME_LENGTH).trim();
}

function sameName(a: string, b: string): boolean {
  return a.toLowerCase() === b.toLowerCase();
}

/** `name`, or `name (2)`, `name (3)`… when a playlist already has it (any case). Used for imported playlists. */
export function uniquePlaylistName(name: string, existing: readonly string[]): string {
  const base = normalizePlaylistName(name);
  if (!existing.some((other) => sameName(other, base))) {
    return base;
  }
  for (let n = 2; n < 10_000; n += 1) {
    const suffix = ` (${n})`;
    const candidate = `${clip(base, MAX_PLAYLIST_NAME_LENGTH - suffix.length).trim()}${suffix}`;
    if (!existing.some((other) => sameName(other, candidate))) {
      return candidate;
    }
  }
  return base;
}

/** The suggestion in the "New playlist" dialog: `Playlist 1`, or the first number not taken. */
export function suggestPlaylistName(existing: readonly string[], format: (number: number) => string): string {
  for (let n = 1; n < 10_000; n += 1) {
    const candidate = format(n);
    if (!existing.some((other) => sameName(other, candidate))) {
      return candidate;
    }
  }
  return format(existing.length + 1);
}

/** An imported file's name without folders and without its extension (`Road trip.m3u8` → `Road trip`). */
export function playlistNameFromFileName(fileName: string | null | undefined): string {
  const base = (fileName ?? '').split(/[\\/]/).pop() ?? '';
  const stem = base.replace(/\.(m3u8?|txt)$/i, '');
  return normalizePlaylistName(stem);
}

/** Characters Windows, Android's SAF providers or FAT cards refuse in a file name. Every other letter stays (Urdu too). */
const UNSAFE_FILE_CHARS = /[\\/:*?"<>|]/g;

/** The export's file name: the playlist's own name (Urdu kept), made safe for any folder, then `.m3u8`. */
export function playlistExportFileName(name: string): string {
  const safe = clip(
    withoutControls(name)
      .replace(UNSAFE_FILE_CHARS, ' ')
      .replace(/\s+/g, ' ')
      .trim()
      .replace(/^\.+/, '')
      .trim(),
    MAX_PLAYLIST_NAME_LENGTH,
  ).trim();
  return `${safe || 'playlist'}.m3u8`;
}
