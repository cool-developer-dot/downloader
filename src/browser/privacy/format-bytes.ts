/** B12: a stored-data size for people: KB below 1 MB (at least 1), MB with one decimal above. Pure. */
export function formatStorageSize(bytes: number): { unit: 'kb' | 'mb'; size: string } {
  if (!Number.isFinite(bytes) || bytes <= 0) return { unit: 'kb', size: '0' };
  if (bytes < 1024 * 1024) return { unit: 'kb', size: String(Math.max(1, Math.round(bytes / 1024))) };
  return { unit: 'mb', size: (bytes / (1024 * 1024)).toFixed(1).replace(/\.0$/, '') };
}
