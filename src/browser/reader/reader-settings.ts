/**
 * B15 #172 / #173 — how the reader looks and reads aloud. Remembered in the settings store (so Backup, Reset and the
 * browser profiles carry them). Pure.
 */

export const READER_THEMES = ['app', 'light', 'sepia', 'dark'] as const;
export type ReaderTheme = (typeof READER_THEMES)[number];
/** Follows the app's light / dark theme. */
export const DEFAULT_READER_THEME: ReaderTheme = 'app';

/** Body text size in dp (the phone's font scale still applies on top). */
export const READER_FONT_SIZES = ['14', '16', '18', '20', '22', '24', '28', '32'] as const;
export type ReaderFontSize = (typeof READER_FONT_SIZES)[number];
export const DEFAULT_READER_FONT_SIZE: ReaderFontSize = '18';

export const READER_FONT_FAMILIES = ['sans', 'serif'] as const;
export type ReaderFontFamily = (typeof READER_FONT_FAMILIES)[number];
export const DEFAULT_READER_FONT_FAMILY: ReaderFontFamily = 'sans';

export const READER_LINE_SPACINGS = ['compact', 'normal', 'wide'] as const;
export type ReaderLineSpacing = (typeof READER_LINE_SPACINGS)[number];
export const DEFAULT_READER_LINE_SPACING: ReaderLineSpacing = 'normal';

export const READER_SPEECH_RATES = ['0.75', '1', '1.25', '1.5', '2'] as const;
export type ReaderSpeechRate = (typeof READER_SPEECH_RATES)[number];
export const DEFAULT_READER_SPEECH_RATE: ReaderSpeechRate = '1';

function pick<T extends string>(choices: readonly T[], fallback: T) {
  return (value: unknown): T => (typeof value === 'string' && (choices as readonly string[]).includes(value) ? (value as T) : fallback);
}

export const normalizeReaderTheme = pick(READER_THEMES, DEFAULT_READER_THEME);
export const normalizeReaderFontSize = pick(READER_FONT_SIZES, DEFAULT_READER_FONT_SIZE);
export const normalizeReaderFontFamily = pick(READER_FONT_FAMILIES, DEFAULT_READER_FONT_FAMILY);
export const normalizeReaderLineSpacing = pick(READER_LINE_SPACINGS, DEFAULT_READER_LINE_SPACING);
export const normalizeReaderSpeechRate = pick(READER_SPEECH_RATES, DEFAULT_READER_SPEECH_RATE);

/** The next bigger / smaller text size (stays at the ends). */
export function stepReaderFontSize(current: ReaderFontSize, direction: 1 | -1): ReaderFontSize {
  const at = READER_FONT_SIZES.indexOf(current);
  const next = Math.min(READER_FONT_SIZES.length - 1, Math.max(0, (at < 0 ? 2 : at) + direction));
  return READER_FONT_SIZES[next];
}

/** Line height as a multiple of the text size. Nastaliq needs more room above and below its letters. */
export function readerLineHeight(spacing: ReaderLineSpacing, nastaliq: boolean): number {
  const base = spacing === 'compact' ? 1.35 : spacing === 'wide' ? 1.9 : 1.6;
  return nastaliq ? base + 0.55 : base;
}

export type ReaderPalette = { background: string; text: string; secondary: string; link: string; highlight: string; rule: string };

/** Fixed reading colours (each pair has at least 4.5:1 contrast for text, checked in the tests). */
export const READER_PALETTES: Record<Exclude<ReaderTheme, 'app'>, ReaderPalette> = {
  light: { background: '#FFFFFF', text: '#1B1B1F', secondary: '#55575E', link: '#0B57D0', highlight: '#FFF1B8', rule: '#DADCE0' },
  sepia: { background: '#F4ECD8', text: '#3B2F22', secondary: '#5F4B36', link: '#7A3E00', highlight: '#E9D49A', rule: '#D9C9A3' },
  dark: { background: '#121316', text: '#E6E6EA', secondary: '#B0B2BA', link: '#A8C7FA', highlight: '#4A3F14', rule: '#3A3B40' },
};

export function readerPalette(theme: ReaderTheme, appIsDark: boolean): ReaderPalette {
  if (theme === 'app') return appIsDark ? READER_PALETTES.dark : READER_PALETTES.light;
  return READER_PALETTES[theme];
}

/** WCAG contrast ratio of two #RRGGBB colours. */
export function contrastRatio(a: string, b: string): number {
  const luminance = (hex: string) => {
    const channel = (i: number) => {
      const c = parseInt(hex.slice(i, i + 2), 16) / 255;
      return c <= 0.03928 ? c / 12.92 : ((c + 0.055) / 1.055) ** 2.4;
    };
    return 0.2126 * channel(1) + 0.7152 * channel(3) + 0.0722 * channel(5);
  };
  const [hi, lo] = [luminance(a), luminance(b)].sort((x, y) => y - x);
  return (hi + 0.05) / (lo + 0.05);
}
