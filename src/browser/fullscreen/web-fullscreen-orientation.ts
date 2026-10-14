/**
 * Which way to hold the phone while a website's video is fullscreen (docs/ARCHITECTURE.md, browser fullscreen).
 * Pure — no React Native imports, so Node tests run it directly.
 */

export type WebFullscreenOrientation = 'landscape' | 'portrait';

export type WebVideoSize = {
  width: number;
  height: number;
};

/**
 * Width ÷ height from which a video counts as wide and turns the phone to landscape. Below it (tall and square
 * videos) the phone stays portrait: a square video is as large either way, so it is not worth a rotation.
 */
export const WEB_FULLSCREEN_WIDE_RATIO = 1.1;

/** Upper bound for a reported side; anything larger is not a real video size. */
const MAX_VIDEO_SIDE = 100_000;

function validSide(value: number): boolean {
  return Number.isFinite(value) && value > 0 && value <= MAX_VIDEO_SIDE;
}

/** The size when both sides are usable, else null (unknown). */
export function normalizeWebVideoSize(size: Partial<WebVideoSize> | null | undefined): WebVideoSize | null {
  if (!size || typeof size.width !== 'number' || typeof size.height !== 'number') {
    return null;
  }
  if (!validSide(size.width) || !validSide(size.height)) {
    return null;
  }
  return { width: size.width, height: size.height };
}

/**
 * Wide → landscape, tall or square → portrait. Unknown size → landscape: fullscreen on the web is overwhelmingly for
 * wide video, and a player in a cross-origin frame (Dailymotion) cannot report one.
 */
export function webFullscreenOrientation(size: Partial<WebVideoSize> | null | undefined): WebFullscreenOrientation {
  const known = normalizeWebVideoSize(size);
  if (!known) {
    return 'landscape';
  }
  return known.width / known.height >= WEB_FULLSCREEN_WIDE_RATIO ? 'landscape' : 'portrait';
}
