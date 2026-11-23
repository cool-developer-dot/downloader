/**
 * P4 Subtitle style: how VidoraX draws subtitle files — app-wide, remembered. Pure.
 *
 * - #592 Size: small / medium / large / extra large (a scale on the picture-relative base size).
 * - #593 Colour: the design's black, white, yellow, red (screen 21), plus green and cyan.
 * - #594 Font: fonts the app already has — the system font (Roboto), Inter (the app's font), Noto Nastaliq Urdu
 *   (bundled for the reader, loaded when first needed) — and Android's serif, monospace and condensed system fonts.
 *   Nastaliq is used for Urdu / Arabic lines; Latin lines in the same subtitle keep the system font.
 * - #595 Background / outline: a dark box, an outline, a drop shadow, or nothing.
 * - #596 Position: at the bottom or the top, moved away from that edge in 2 % steps (0–40 % of the picture).
 * - #599 Dual: where the second subtitle goes — next to the first, or at the top of the picture.
 */

export const SUBTITLE_SIZES = ['small', 'medium', 'large', 'xlarge'] as const;
export type SubtitleSize = (typeof SUBTITLE_SIZES)[number];
export const SUBTITLE_SIZE_SCALE: Readonly<Record<SubtitleSize, number>> = { small: 0.8, medium: 1, large: 1.25, xlarge: 1.5 };

export const SUBTITLE_COLORS = ['white', 'yellow', 'black', 'red', 'green', 'cyan'] as const;
export type SubtitleColor = (typeof SUBTITLE_COLORS)[number];
/** The design's swatches (screen 21: #000000, #FFFFFF, #FFD60A, #D92D20), and two more easy-to-read ones. */
export const SUBTITLE_COLOR_HEX: Readonly<Record<SubtitleColor, string>> = {
  white: '#FFFFFF',
  yellow: '#FFD60A',
  black: '#000000',
  red: '#D92D20',
  green: '#34C759',
  cyan: '#32D2F5',
};

export const SUBTITLE_FONTS = ['system', 'inter', 'serif', 'monospace', 'condensed', 'nastaliq'] as const;
export type SubtitleFont = (typeof SUBTITLE_FONTS)[number];

export const SUBTITLE_EDGES = ['box', 'outline', 'shadow', 'none'] as const;
export type SubtitleEdge = (typeof SUBTITLE_EDGES)[number];

export const SUBTITLE_ANCHORS = ['bottom', 'top'] as const;
export type SubtitleAnchor = (typeof SUBTITLE_ANCHORS)[number];

export const SECOND_SUBTITLE_POSITIONS = ['next', 'top'] as const;
export type SecondSubtitlePosition = (typeof SECOND_SUBTITLE_POSITIONS)[number];

export type SubtitleStyle = {
  size: SubtitleSize;
  color: SubtitleColor;
  font: SubtitleFont;
  edge: SubtitleEdge;
  anchor: SubtitleAnchor;
  /** Distance from the anchored edge, in % of the picture's height. */
  marginPercent: number;
  secondPosition: SecondSubtitlePosition;
};

export const SUBTITLE_MARGIN_STEP = 2;
export const MAX_SUBTITLE_MARGIN = 40;

export const DEFAULT_SUBTITLE_STYLE: SubtitleStyle = {
  size: 'medium',
  color: 'white',
  font: 'system',
  edge: 'box',
  anchor: 'bottom',
  marginPercent: 4,
  secondPosition: 'next',
};

function pick<T extends string>(options: readonly T[], value: unknown, fallback: T): T {
  return typeof value === 'string' && (options as readonly string[]).includes(value) ? (value as T) : fallback;
}

export function normalizeSubtitleMargin(value: unknown): number {
  if (typeof value !== 'number' || !Number.isFinite(value)) {
    return DEFAULT_SUBTITLE_STYLE.marginPercent;
  }
  const stepped = Math.round(value / SUBTITLE_MARGIN_STEP) * SUBTITLE_MARGIN_STEP;
  return Math.max(0, Math.min(MAX_SUBTITLE_MARGIN, stepped));
}

/** A stored style, each field checked on its own (a damaged field falls back to its default, the rest is kept). */
export function normalizeSubtitleStyle(raw: unknown): SubtitleStyle {
  const value = raw && typeof raw === 'object' ? (raw as Record<string, unknown>) : {};
  return {
    size: pick(SUBTITLE_SIZES, value.size, DEFAULT_SUBTITLE_STYLE.size),
    color: pick(SUBTITLE_COLORS, value.color, DEFAULT_SUBTITLE_STYLE.color),
    font: pick(SUBTITLE_FONTS, value.font, DEFAULT_SUBTITLE_STYLE.font),
    edge: pick(SUBTITLE_EDGES, value.edge, DEFAULT_SUBTITLE_STYLE.edge),
    anchor: pick(SUBTITLE_ANCHORS, value.anchor, DEFAULT_SUBTITLE_STYLE.anchor),
    marginPercent: normalizeSubtitleMargin(value.marginPercent),
    secondPosition: pick(SECOND_SUBTITLE_POSITIONS, value.secondPosition, DEFAULT_SUBTITLE_STYLE.secondPosition),
  };
}

/** The style after moving the subtitles `steps` × 2 % away from (positive) or towards (negative) their edge. */
export function stepSubtitleMargin(style: SubtitleStyle, steps: number): SubtitleStyle {
  return { ...style, marginPercent: normalizeSubtitleMargin(style.marginPercent + steps * SUBTITLE_MARGIN_STEP) };
}

/** The colour behind or around the text: dark for light text, light for black text, so it always reads. */
export function subtitleEdgeColor(color: SubtitleColor, alpha: number): string {
  return color === 'black' ? `rgba(255,255,255,${alpha})` : `rgba(0,0,0,${alpha})`;
}

/**
 * The text's font family for a line. Nastaliq applies to right-to-left lines only (Latin lines keep the system font)
 * and only once it has loaded; null means the system font.
 */
export function subtitleFontFamily(
  font: SubtitleFont,
  direction: 'rtl' | 'ltr',
  families: { inter: string; nastaliq: string; nastaliqReady: boolean },
): string | null {
  switch (font) {
    case 'inter':
      return families.inter;
    case 'serif':
      return 'serif';
    case 'monospace':
      return 'monospace';
    case 'condensed':
      return 'sans-serif-condensed';
    case 'nastaliq':
      return direction === 'rtl' && families.nastaliqReady ? families.nastaliq : null;
    default:
      return null;
  }
}

/** Line height for a font size: Nastaliq's tall letters need about twice the size, other fonts 1.3×. */
export function subtitleLineHeight(fontSize: number, nastaliq: boolean): number {
  return Math.round(fontSize * (nastaliq ? 2 : 1.3));
}
