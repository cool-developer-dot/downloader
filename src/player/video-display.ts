/**
 * P2 Video fit & display: how the picture is drawn in the Player's surface. Pure, no React, no native code.
 *
 * - #564 Aspect ratio: force 16:9, 4:3 or 21:9 (the picture is stretched into a box of that shape, centred).
 * - #565 Crop to fill: cover the whole area, cutting off what sticks out (no black bars).
 * - #566 Stretch: fill the whole area, the picture's shape not kept.
 * - #573 Mirror / Flip: left ↔ right, upside down, or both (a view transform; the surface is a TextureView).
 * - #576 Notch / cutout: in full screen the picture can be kept clear of the camera cutout (`pictureArea`).
 * - #721 Info overlay: codec, size, frame rate, bit rate, dynamic range and speed of what is playing.
 *
 * expo-video's `contentFit` is only contain / cover / fill, so a forced ratio is a box of that ratio with `fill` in it.
 */

import { formatPlaybackRateChip } from './playback-rates';
import { fittedContentSize, type Size } from './zoom-math';

// ── Fit (#564, #565, #566) ───────────────────────────────────────────────────────────────────────────────────────

/** In the Aspect ratio sheet's order. `fit` is the default: the whole picture, its own shape. */
export const VIDEO_FITS = ['fit', 'crop', 'stretch', '16:9', '4:3', '21:9'] as const;
export type VideoFit = (typeof VIDEO_FITS)[number];
export type VideoRatioFit = Extract<VideoFit, `${number}:${number}`>;
export const DEFAULT_VIDEO_FIT: VideoFit = 'fit';

/** What expo-video's VideoView is given. */
export type VideoContentFit = 'contain' | 'cover' | 'fill';

export type Rect = { x: number; y: number; width: number; height: number };
export type Insets = { top: number; right: number; bottom: number; left: number };

export function isVideoFit(value: unknown): value is VideoFit {
  return typeof value === 'string' && (VIDEO_FITS as readonly string[]).includes(value);
}

export function normalizeVideoFit(value: unknown): VideoFit {
  return isVideoFit(value) ? value : DEFAULT_VIDEO_FIT;
}

export function isRatioFit(fit: VideoFit): fit is VideoRatioFit {
  return fit.includes(':');
}

/** Width over height of a forced ratio; null for fit, crop and stretch. */
export function fitRatio(fit: VideoFit): number | null {
  if (!isRatioFit(fit)) {
    return null;
  }
  const [w, h] = fit.split(':').map(Number);
  return w && h ? w / h : null;
}

function usable(size: Size | null | undefined): size is Size {
  return size != null && Number.isFinite(size.width) && Number.isFinite(size.height) && size.width > 0 && size.height > 0;
}

function finiteInset(value: number | undefined): number {
  return Number.isFinite(value) && (value as number) > 0 ? (value as number) : 0;
}

/**
 * The part of the surface the picture may use. With insets (the camera cutout in full screen, #576) the picture keeps
 * clear of them and stays centred: the larger inset of each axis is taken on both sides.
 */
export function pictureArea(surface: Size, insets?: Insets | null): Rect {
  if (!usable(surface)) {
    return { x: 0, y: 0, width: 0, height: 0 };
  }
  if (!insets) {
    return { x: 0, y: 0, width: surface.width, height: surface.height };
  }
  const horizontal = Math.max(finiteInset(insets.left), finiteInset(insets.right));
  const vertical = Math.max(finiteInset(insets.top), finiteInset(insets.bottom));
  const width = Math.max(0, surface.width - horizontal * 2);
  const height = Math.max(0, surface.height - vertical * 2);
  if (width === 0 || height === 0) {
    // Insets bigger than the surface (a tiny window): ignore them rather than draw nothing.
    return { x: 0, y: 0, width: surface.width, height: surface.height };
  }
  return { x: horizontal, y: vertical, width, height };
}

/** The largest box of `ratio` (width / height) inside `area`, centred in it. */
export function ratioBox(area: Rect, ratio: number): Rect {
  if (!(ratio > 0) || area.width <= 0 || area.height <= 0) {
    return area;
  }
  const width = Math.min(area.width, area.height * ratio);
  const height = width / ratio;
  return { x: area.x + (area.width - width) / 2, y: area.y + (area.height - height) / 2, width, height };
}

export type VideoFitLayout = {
  /** Where the VideoView is drawn inside the surface. */
  frame: Rect;
  /** True when the frame is the whole surface (the view is simply laid over it, as before P2). */
  fullSurface: boolean;
  contentFit: VideoContentFit;
  /**
   * The picture as visible at zoom 1: what pinch-zoom pans against. Crop draws the picture bigger than the frame, but
   * it is clipped to the frame (Media3's ZOOM mode inside the view, and the frame view clips too), so for crop this is
   * the frame: panning a zoomed crop never shows a black edge.
   */
  content: Size;
};

/**
 * How the VideoView is laid out for a fit: its frame in the surface, the `contentFit` it gets, and the picture's drawn
 * size. `insets` keeps the picture clear of the camera cutout (#576); null lets it use the whole surface.
 */
export function videoFitLayout(
  surface: Size,
  picture: Size | null | undefined,
  fit: VideoFit,
  insets?: Insets | null,
): VideoFitLayout {
  const area = pictureArea(surface, insets);
  const ratio = fitRatio(fit);
  const frame = ratio ? ratioBox(area, ratio) : area;
  const fullSurface =
    usable(surface) && frame.x === 0 && frame.y === 0 && frame.width === surface.width && frame.height === surface.height;
  const frameSize = { width: frame.width, height: frame.height };
  if (fit === 'crop' || fit === 'stretch' || ratio) {
    // Crop covers its frame (the rest is cut off); stretch and a forced ratio fill it.
    return { frame, fullSurface, contentFit: fit === 'crop' ? 'cover' : 'fill', content: frameSize };
  }
  return { frame, fullSurface, contentFit: 'contain', content: fittedContentSize(frameSize, picture) };
}

/** The picture's shape as the fit shows it (a forced ratio reshapes it); for a card or window that follows it. */
export function displayedAspect(fit: VideoFit, picture: Size | null | undefined): Size | null {
  const ratio = fitRatio(fit);
  if (ratio) {
    return { width: ratio, height: 1 };
  }
  return usable(picture) ? picture : null;
}

// ── Per-video memory of the fit ─────────────────────────────────────────────────────────────────────────────────

/** How many videos' fit choices are kept (the oldest is forgotten first). */
export const MAX_REMEMBERED_FITS = 500;

/** `[mediaId, fit]`, least recently chosen first. Only videos with a fit other than the default are listed. */
export type RememberedFits = readonly (readonly [string, VideoFit])[];

/** Reads a stored list, dropping anything malformed (storage written by an older or broken build). */
export function readRememberedFits(raw: unknown, max = MAX_REMEMBERED_FITS): RememberedFits {
  if (!Array.isArray(raw)) {
    return [];
  }
  const seen = new Set<string>();
  const out: (readonly [string, VideoFit])[] = [];
  // Walk from the newest so a duplicated id keeps its latest choice.
  for (let i = raw.length - 1; i >= 0 && out.length < max; i -= 1) {
    const entry: unknown = raw[i];
    if (!Array.isArray(entry) || entry.length !== 2) continue;
    const [id, fit] = entry as unknown[];
    if (typeof id !== 'string' || !id || seen.has(id) || !isVideoFit(fit) || fit === DEFAULT_VIDEO_FIT) continue;
    seen.add(id);
    out.push([id, fit]);
  }
  return out.reverse();
}

/** The list after choosing `fit` for `mediaId`: moved to the newest end, or removed when back to the default. */
export function rememberFit(list: RememberedFits, mediaId: string, fit: VideoFit, max = MAX_REMEMBERED_FITS): RememberedFits {
  const rest = list.filter(([id]) => id !== mediaId);
  if (fit === DEFAULT_VIDEO_FIT) {
    return rest;
  }
  const next = [...rest, [mediaId, fit] as const];
  return next.length > max ? next.slice(next.length - max) : next;
}

export function fitFor(list: RememberedFits, mediaId: string | null | undefined): VideoFit {
  if (!mediaId) {
    return DEFAULT_VIDEO_FIT;
  }
  for (let i = list.length - 1; i >= 0; i -= 1) {
    const entry = list[i]!;
    if (entry[0] === mediaId) {
      return entry[1];
    }
  }
  return DEFAULT_VIDEO_FIT;
}

// ── Mirror / Flip (#573) ────────────────────────────────────────────────────────────────────────────────────────

/** In the Mirror / Flip sheet's order. `both` turns the picture half a turn. */
export const MIRROR_MODES = ['none', 'horizontal', 'vertical', 'both'] as const;
export type MirrorMode = (typeof MIRROR_MODES)[number];

export function isMirrorMode(value: unknown): value is MirrorMode {
  return typeof value === 'string' && (MIRROR_MODES as readonly string[]).includes(value);
}

export function mirrorScale(mode: MirrorMode): { scaleX: 1 | -1; scaleY: 1 | -1 } {
  return {
    scaleX: mode === 'horizontal' || mode === 'both' ? -1 : 1,
    scaleY: mode === 'vertical' || mode === 'both' ? -1 : 1,
  };
}

// ── Info overlay (#721) ─────────────────────────────────────────────────────────────────────────────────────────

const CODEC_NAMES: Record<string, string> = {
  'video/avc': 'H.264',
  'video/hevc': 'H.265 (HEVC)',
  'video/av01': 'AV1',
  'video/x-vnd.on2.vp8': 'VP8',
  'video/x-vnd.on2.vp9': 'VP9',
  'video/dolby-vision': 'Dolby Vision',
  'video/mp4v-es': 'MPEG-4',
  'video/3gpp': 'H.263',
  'video/mpeg2': 'MPEG-2',
  'video/mpeg': 'MPEG-1',
  'video/x-matroska': 'Matroska',
  'video/divx': 'DivX',
  'video/wvc1': 'VC-1',
  'video/mjpeg': 'Motion JPEG',
};

/** "H.264" for `video/avc`; an unknown type shows its own name (`video/x-foo` → "X-FOO"); null when unknown. */
export function videoCodecName(mimeType: string | null | undefined): string | null {
  if (typeof mimeType !== 'string') {
    return null;
  }
  const mime = mimeType.trim().toLowerCase();
  if (!mime) {
    return null;
  }
  const known = CODEC_NAMES[mime];
  if (known) {
    return known;
  }
  const subtype = mime.includes('/') ? mime.slice(mime.indexOf('/') + 1) : mime;
  return subtype ? subtype.toUpperCase() : null;
}

/** Bits per second → "4.2 Mb/s" / "850 kb/s"; null when unknown. */
export function formatBitrate(bitsPerSecond: number | null | undefined): string | null {
  if (bitsPerSecond == null || !Number.isFinite(bitsPerSecond) || bitsPerSecond <= 0) {
    return null;
  }
  if (bitsPerSecond >= 1_000_000) {
    const mbps = bitsPerSecond / 1_000_000;
    return `${mbps >= 100 ? Math.round(mbps) : Number(mbps.toFixed(1))} Mb/s`;
  }
  return `${Math.max(1, Math.round(bitsPerSecond / 1000))} kb/s`;
}

/** "30 fps", "29.97 fps", "23.976 fps"; null when unknown. */
export function formatFrameRate(fps: number | null | undefined): string | null {
  if (fps == null || !Number.isFinite(fps) || fps <= 0) {
    return null;
  }
  return `${Number(fps.toFixed(3))} fps`;
}

export type VideoRangeName = 'sdr' | 'hlg' | 'pq';

/** The track's dynamic range: SDR, HDR (HLG) or HDR (PQ, as HDR10 and Dolby Vision use). */
export function videoRangeLabel(range: string | null | undefined): string | null {
  if (range === 'sdr') return 'SDR';
  if (range === 'hlg') return 'HDR (HLG)';
  if (range === 'pq') return 'HDR (PQ)';
  return null;
}

export type VideoInfoInput = {
  mimeType: string | null;
  width: number | null;
  height: number | null;
  frameRate: number | null;
  averageBitrate: number | null;
  peakBitrate: number | null;
  videoRange: string | null;
  playbackRate: number;
};

export const VIDEO_INFO_ROWS = ['codec', 'resolution', 'frameRate', 'bitrate', 'range', 'speed'] as const;
export type VideoInfoRowKey = (typeof VIDEO_INFO_ROWS)[number];
export type VideoInfoRow = { key: VideoInfoRowKey; value: string };

/** The overlay's rows, in order; a value the player does not know is left out. The speed is always shown. */
export function videoInfoRows(input: VideoInfoInput): VideoInfoRow[] {
  const rows: VideoInfoRow[] = [];
  const push = (key: VideoInfoRowKey, value: string | null) => {
    if (value) rows.push({ key, value });
  };
  push('codec', videoCodecName(input.mimeType));
  push(
    'resolution',
    input.width && input.height && input.width > 0 && input.height > 0 ? `${input.width} × ${input.height}` : null,
  );
  push('frameRate', formatFrameRate(input.frameRate));
  push('bitrate', formatBitrate(input.averageBitrate ?? input.peakBitrate));
  push('range', videoRangeLabel(input.videoRange));
  push('speed', formatPlaybackRateChip(input.playbackRate));
  return rows;
}
