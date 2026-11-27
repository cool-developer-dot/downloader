/**
 * Files F2 · #770 Show extensions: the name a Files row shows — "clip.mp4" with extensions on, "clip" with them off.
 * Pure. Only the last extension goes ("a.b.mp4" → "a.b"); a name with no extension, or one that is only an extension
 * (".mp4"), stays as it is.
 */
export function displayFileName(name: string, showExtensions: boolean): string {
  if (showExtensions) {
    return name;
  }
  const dot = name.lastIndexOf('.');
  if (dot <= 0 || dot === name.length - 1) {
    return name;
  }
  return name.slice(0, dot);
}
