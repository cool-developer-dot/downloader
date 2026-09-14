/**
 * Generic embedded-player / iframe ownership heuristics.
 * No site-specific host table. No cross-origin DOM access.
 */

export type GeneralPlayerKind = 'video' | 'iframe';
export type GeneralFrameClass = 'top' | 'same-origin' | 'cross-origin';
export type GeneralOwnerStrength = 'STRONG' | 'MEDIUM' | 'WEAK';

const MIN_IFRAME_WIDTH = 140;
const MIN_IFRAME_HEIGHT = 80;
const MIN_IFRAME_AREA = 20_000;
const STRONG_IFRAME_AREA = 40_000;

const PLAYER_SRC_RE = /\/(?:embed|player|video|media|watch)\/[A-Za-z0-9_.-]+/i;
const PLAYER_HOST_RE = /(?:^|\.)(?:player|embed)\./i;

const NON_PLAYER_SRC_RE =
  /googleads|doubleclick|googlesyndication|adservice|about:blank|javascript:/i;

export type GeneralIframePlayerEvidence = {
  iframeIdentity: string;
  iframeSrc: string | null;
  frameClass: GeneralFrameClass;
  isDisplayed: boolean;
  isVisibleStyle: boolean;
  intersectionRatio: number | null;
  width: number | null;
  height: number | null;
  allowFullscreen: boolean;
  allow: string | null;
  looksPlayer: boolean;
  sameOriginVideoCount: number | null;
};

export function iframeArea(width: number | null, height: number | null): number {
  if (width == null || height == null || width <= 0 || height <= 0) {
    return 0;
  }
  return width * height;
}

export function looksLikePlayerIframeSrc(src: string | null | undefined): boolean {
  if (!src) {
    return false;
  }
  if (NON_PLAYER_SRC_RE.test(src)) {
    return false;
  }
  return PLAYER_SRC_RE.test(src) || PLAYER_HOST_RE.test(src);
}

export function iframeAllowLooksMedia(allow: string | null | undefined): boolean {
  if (!allow) {
    return false;
  }
  const lower = allow.toLowerCase();
  return (
    lower.includes('autoplay') ||
    lower.includes('encrypted-media') ||
    lower.includes('fullscreen')
  );
}

/**
 * Visible player-like iframe — not every iframe.
 * Requires size plus (player src OR fullscreen/autoplay media allow).
 */
export function looksLikeGeneralPlayerIframe(input: {
  src: string | null | undefined;
  width: number | null;
  height: number | null;
  isDisplayed: boolean;
  allowFullscreen?: boolean;
  allow?: string | null;
}): boolean {
  if (!input.isDisplayed) {
    return false;
  }
  const width = input.width ?? 0;
  const height = input.height ?? 0;
  const area = iframeArea(width, height);
  if (width < MIN_IFRAME_WIDTH || height < MIN_IFRAME_HEIGHT || area < MIN_IFRAME_AREA) {
    return false;
  }
  if (looksLikePlayerIframeSrc(input.src ?? null)) {
    return true;
  }
  const mediaAllow =
    Boolean(input.allowFullscreen) || iframeAllowLooksMedia(input.allow);
  return mediaAllow && area >= STRONG_IFRAME_AREA;
}

export function shouldAcceptIframeAsCurrentOwner(input: {
  looksPlayer: boolean;
  isDisplayed: boolean;
  isVisibleStyle?: boolean;
  intersectionRatio: number | null;
  width: number | null;
  height: number | null;
  sameOriginVideoCount?: number | null;
}): boolean {
  if (!input.isDisplayed || input.isVisibleStyle === false) {
    return false;
  }
  if (!input.looksPlayer && !(input.sameOriginVideoCount && input.sameOriginVideoCount > 0)) {
    return false;
  }
  if (iframeArea(input.width, input.height) < MIN_IFRAME_AREA) {
    return false;
  }
  if (input.intersectionRatio == null) {
    return true;
  }
  return input.intersectionRatio >= 0.25;
}

export function resolveIframeOwnerStrength(input: {
  looksPlayer: boolean;
  isDisplayed: boolean;
  intersectionRatio: number | null;
  sameOriginVideoCount?: number | null;
  recentlyPlayed?: boolean;
}): GeneralOwnerStrength | null {
  if (!input.isDisplayed || !input.looksPlayer) {
    if (!(input.sameOriginVideoCount && input.sameOriginVideoCount > 0 && input.isDisplayed)) {
      return null;
    }
  }
  if (input.sameOriginVideoCount && input.sameOriginVideoCount > 0) {
    return 'STRONG';
  }
  const ratio = input.intersectionRatio;
  if (ratio != null && ratio >= 0.55) {
    return 'STRONG';
  }
  if (input.recentlyPlayed || ratio == null || ratio >= 0.35) {
    return 'MEDIUM';
  }
  if (ratio >= 0.25) {
    return 'MEDIUM';
  }
  return null;
}

export function isNonVideoIframe(input: {
  src: string | null;
  looksPlayer: boolean;
  sameOriginVideoCount?: number | null;
}): boolean {
  if (input.sameOriginVideoCount && input.sameOriginVideoCount > 0) {
    return false;
  }
  if (input.looksPlayer) {
    return false;
  }
  if (input.src && NON_PLAYER_SRC_RE.test(input.src)) {
    return true;
  }
  return true;
}
