/**
 * B21 #245 — the start page's background. Pure.
 *
 * `theme` (default: today's page colour), a colour, a gradient, or a photo the user picked (copied by VidoraWeb into
 * `<filesDir>/start-page/background-<time>.jpg`). With anything but the theme, a dark layer goes over it and the start
 * page uses the dark palette, so text stays readable in both app themes.
 */

export type StartPageBackgroundKind = 'theme' | 'color' | 'gradient' | 'photo';

export const START_PAGE_BACKGROUND_KINDS: readonly StartPageBackgroundKind[] = ['theme', 'color', 'gradient', 'photo'];

export function normalizeStartPageBackground(value: unknown): StartPageBackgroundKind {
  return START_PAGE_BACKGROUND_KINDS.includes(value as StartPageBackgroundKind)
    ? (value as StartPageBackgroundKind)
    : 'theme';
}

export type ColorPreset = { id: string; color: string };
export type GradientPreset = { id: string; colors: readonly [string, string] };

export const START_PAGE_COLORS: readonly ColorPreset[] = [
  { id: 'night', color: '#1B2433' },
  { id: 'forest', color: '#1F4D3A' },
  { id: 'ocean', color: '#155E75' },
  { id: 'plum', color: '#4A2545' },
  { id: 'rust', color: '#7C2D12' },
  { id: 'slate', color: '#475569' },
];

export const START_PAGE_GRADIENTS: readonly GradientPreset[] = [
  { id: 'dusk', colors: ['#1E3A8A', '#9D174D'] },
  { id: 'lagoon', colors: ['#0F766E', '#1E40AF'] },
  { id: 'ember', colors: ['#7C2D12', '#B45309'] },
  { id: 'aurora', colors: ['#14532D', '#4C1D95'] },
];

export const START_PAGE_COLOR_IDS = START_PAGE_COLORS.map((c) => c.id);
export const START_PAGE_GRADIENT_IDS = START_PAGE_GRADIENTS.map((g) => g.id);

export function colorPreset(id: unknown): ColorPreset {
  return START_PAGE_COLORS.find((c) => c.id === id) ?? START_PAGE_COLORS[0];
}

export function gradientPreset(id: unknown): GradientPreset {
  return START_PAGE_GRADIENTS.find((g) => g.id === id) ?? START_PAGE_GRADIENTS[0];
}

/** Black at this opacity over the colour, gradient or photo. */
export const START_PAGE_DARK_LAYER_OPACITY = 0.45;

const PHOTO_URI = /^file:\/\/\/[^?#]*\/start-page\/background-\d{1,16}\.jpg$/;

/** Only a photo VidoraWeb wrote into the app's own start-page folder is shown (a restored backup can't point elsewhere). */
export function readStartPagePhoto(stored: unknown): string | null {
  return typeof stored === 'string' && PHOTO_URI.test(stored) && !stored.includes('..') ? stored : null;
}

export type StartPageBackground =
  | { kind: 'theme' }
  | { kind: 'color'; color: string }
  | { kind: 'gradient'; colors: readonly [string, string] }
  | { kind: 'photo'; uri: string };

/** What to draw. A photo setting without a usable photo shows the theme. */
export function resolveStartPageBackground(settings: {
  kind: unknown;
  color: unknown;
  gradient: unknown;
  photo: unknown;
}): StartPageBackground {
  switch (normalizeStartPageBackground(settings.kind)) {
    case 'color':
      return { kind: 'color', color: colorPreset(settings.color).color };
    case 'gradient':
      return { kind: 'gradient', colors: gradientPreset(settings.gradient).colors };
    case 'photo': {
      const uri = readStartPagePhoto(settings.photo);
      return uri ? { kind: 'photo', uri } : { kind: 'theme' };
    }
    default:
      return { kind: 'theme' };
  }
}
