/**
 * Stable media identifier from discriminating fields.
 * Uses a fast non-crypto hash suitable for client-side dedup keys.
 */

function fnv1a(input: string): string {
  let hash = 0x811c9dc5;
  for (let i = 0; i < input.length; i += 1) {
    hash ^= input.charCodeAt(i);
    hash = Math.imul(hash, 0x01000193);
  }
  return (hash >>> 0).toString(16).padStart(8, '0');
}

export type MediaIdentityInput = {
  url: string;
  mimeType?: string | null;
  container?: string | null;
  width?: number | null;
  height?: number | null;
  bitrate?: number | null;
  streamProtocol?: string | null;
  playlistType?: string | null;
};

export function buildMediaId(input: MediaIdentityInput): string {
  const parts = [
    input.url.trim(),
    input.mimeType?.toLowerCase() ?? '',
    input.container?.toLowerCase() ?? '',
    input.width != null ? String(input.width) : '',
    input.height != null ? String(input.height) : '',
    input.bitrate != null ? String(input.bitrate) : '',
    input.streamProtocol?.toLowerCase() ?? '',
    input.playlistType?.toLowerCase() ?? '',
  ];

  return `md_${fnv1a(parts.join('|'))}`;
}
