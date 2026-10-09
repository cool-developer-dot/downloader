/**
 * Pinch-zoom geometry for the video surface. Pure functions, also run on the UI thread as worklets.
 *
 * The video is drawn "contain"-fitted inside the surface (aspect ratio kept). Zoom scales that picture uniformly about
 * the surface centre, then translates it. Coordinates below are relative to the surface centre.
 */

/** Fitted — the whole picture visible. */
export const MIN_ZOOM = 1;
/** Four times the fitted size: enough to read a detail, not so much that the picture turns to mush. */
export const MAX_ZOOM = 4;
/** A scale within this of 1 settles back to fitted. */
export const ZOOM_SNAP_EPSILON = 0.04;
/** How far a pinch may overshoot the limits before the rubber band stops it. */
const SCALE_OVERSHOOT = 0.25;
const RUBBER_BAND_FACTOR = 0.35;

export type Size = { width: number; height: number };

function isUsableSize(size: Size | null | undefined): size is Size {
  'worklet';
  return (
    size != null &&
    Number.isFinite(size.width) &&
    Number.isFinite(size.height) &&
    size.width > 0 &&
    size.height > 0
  );
}

/** Size of the picture as drawn at zoom 1 (contain). Unknown video size → the whole surface. */
export function fittedContentSize(surface: Size, video: Size | null | undefined): Size {
  'worklet';
  if (!isUsableSize(surface)) {
    return { width: 0, height: 0 };
  }
  if (!isUsableSize(video)) {
    return { width: surface.width, height: surface.height };
  }
  const fit = Math.min(surface.width / video.width, surface.height / video.height);
  return { width: video.width * fit, height: video.height * fit };
}

/** Largest translation along one axis that keeps the zoomed picture covering the surface (0 while it fits). */
export function maxTranslation(surfaceLength: number, contentLength: number, scale: number): number {
  'worklet';
  if (!Number.isFinite(surfaceLength) || !Number.isFinite(contentLength) || !Number.isFinite(scale)) {
    return 0;
  }
  return Math.max(0, (contentLength * scale - surfaceLength) / 2);
}

export function clampTranslation(value: number, max: number): number {
  'worklet';
  if (!Number.isFinite(value)) {
    return 0;
  }
  const limit = Math.max(0, max);
  return Math.min(limit, Math.max(-limit, value));
}

/** Past the limits a drag keeps moving, but with resistance, so the edge is felt instead of hit. */
export function rubberBandTranslation(value: number, max: number): number {
  'worklet';
  const limit = Math.max(0, max);
  if (value > limit) {
    return limit + (value - limit) * RUBBER_BAND_FACTOR;
  }
  if (value < -limit) {
    return -limit + (value + limit) * RUBBER_BAND_FACTOR;
  }
  return value;
}

/** Scale while the fingers are down: free inside the limits, resisted just outside them, bounded overall. */
export function rubberBandScale(raw: number): number {
  'worklet';
  if (!Number.isFinite(raw) || raw <= 0) {
    return MIN_ZOOM;
  }
  if (raw < MIN_ZOOM) {
    return Math.max(MIN_ZOOM * (1 - SCALE_OVERSHOOT), MIN_ZOOM - (MIN_ZOOM - raw) * RUBBER_BAND_FACTOR);
  }
  if (raw > MAX_ZOOM) {
    return Math.min(MAX_ZOOM * (1 + SCALE_OVERSHOOT), MAX_ZOOM + (raw - MAX_ZOOM) * RUBBER_BAND_FACTOR);
  }
  return raw;
}

/** Where a scale comes to rest when the fingers lift. */
export function settleScale(scale: number): number {
  'worklet';
  if (!Number.isFinite(scale) || scale < MIN_ZOOM + ZOOM_SNAP_EPSILON) {
    return MIN_ZOOM;
  }
  return Math.min(MAX_ZOOM, scale);
}

export function isZoomed(scale: number): boolean {
  'worklet';
  return Number.isFinite(scale) && scale >= MIN_ZOOM + ZOOM_SNAP_EPSILON;
}

/**
 * Translation that keeps the picture point that was under the fingers at the start of the pinch under the fingers
 * now — pinching zooms "into" where the user touches, and moving both fingers pans at the same time.
 */
export function anchoredTranslation(
  focal: number,
  startFocal: number,
  startTranslation: number,
  startScale: number,
  scale: number,
): number {
  'worklet';
  if (!Number.isFinite(startScale) || startScale <= 0) {
    return startTranslation;
  }
  return focal - (scale * (startFocal - startTranslation)) / startScale;
}

/** A settled translation for `scale` on both axes. */
export function settleTranslation(
  translation: { x: number; y: number },
  surface: Size,
  content: Size,
  scale: number,
): { x: number; y: number } {
  'worklet';
  if (!isZoomed(scale)) {
    return { x: 0, y: 0 };
  }
  return {
    x: clampTranslation(translation.x, maxTranslation(surface.width, content.width, scale)),
    y: clampTranslation(translation.y, maxTranslation(surface.height, content.height, scale)),
  };
}

/** Parses a "1280x720" resolution label into a size. */
export function parseResolution(value: string | null | undefined): Size | null {
  if (!value) {
    return null;
  }
  const match = /^(\d{2,5})\s*[x×]\s*(\d{2,5})$/i.exec(value.trim());
  if (!match) {
    return null;
  }
  const width = Number(match[1]);
  const height = Number(match[2]);
  return width > 0 && height > 0 ? { width, height } : null;
}
