/**
 * VidoraX colour tokens — the six themes of the CEO's handoff `VidoraX-6-Themes-65-Screens.pdf`.
 *
 * Every theme draws the same 65 screens; only the colours change, so one builder (`designTheme`) turns a measured
 * palette into the full token set. The palettes were read from the PDF's vector data, not from screenshots:
 * each hex below is the fill or text colour the frames use (see `docs/design/light-theme-kit.md` → "The six themes").
 *
 * - light    — #FAF9FB page, white cards, #D92D20 accent (the default)
 * - dark     — #121214 page, #1D1D20 cards, #E5382B accent
 * - red      — #FDF1EF page, #FFF9F8 cards; the header and the bottom bar are a #D92D20 band with white text
 * - cream    — #FBF6EC page, #FFFDF8 cards, #C8321F accent
 * - midnight — #0D1424 page, #151D31 cards, #FF4A3D accent
 * - blush    — #FFF5F7 page, white cards, #E0313F accent
 *
 * Green appears only as the semantic `success` (completed / positive status). Legacy `logo` preferences resolve to
 * `red` (`normalizeThemePreference`).
 */

/** Canonical VidoraX brand red (logo asset) — kept for the splash / onboarding art. */
export const brandPalette = {
  brandRed: '#DC3C2C',
  brandRedPressed: '#C43426',
  brandRedMuted: '#F2A39C',
  brandRedSoft: '#FCE8E6',
  onBrandRed: '#FFFFFF',
  sourceAsset: 'assets/logos/vidorax-logo.png',
  sourceHex: '#DC3C2C',
} as const;

/** Apply alpha to a 6-digit hex color. */
export function withAlpha(hex: string, alpha: number): string {
  const normalized = hex.replace('#', '');
  const r = parseInt(normalized.slice(0, 2), 16);
  const g = parseInt(normalized.slice(2, 4), 16);
  const b = parseInt(normalized.slice(4, 6), 16);
  return `rgba(${r}, ${g}, ${b}, ${alpha})`;
}

const WHITE = '#FFFFFF';
const BLACK = '#000000';

/** The colours one design theme is drawn with (measured from its frames). */
export type DesignPalette = {
  /** The page behind the cards. */
  page: string;
  /** Cards, the search field, chips, tiles, the header button. */
  card: string;
  /** The hairline edge of cards, chips and fields. */
  cardBorder: string;
  /** The 1 dp line between rows; also the progress track. */
  divider: string;
  /** Buttons, toggles on, section labels, icons, the selected tab. */
  accent: string;
  /** The accent while pressed. */
  accentPressed: string;
  /** The 34 dp icon tiles and the selected chip. */
  accentSoft: string;
  /** A lighter accent for secondary bars / badges. */
  accentMuted: string;
  text: string;
  textSecondary: string;
  textDisabled: string;
  /** A card while pressed. */
  pressed: string;
  /** A toggle that is off. */
  switchOff: string;
  success: string;
  /** Dark page and cards (Android night mode, dark navigation / Paper bases, force-dark web pages). */
  dark: boolean;
  /** `band`: the header and the bottom bar are painted in the accent with white text (the Red theme). */
  chrome: 'flat' | 'band';
};

const semanticShared = {
  warning: '#D97706',
  info: '#5B9AA9',
  white: WHITE,
  black: BLACK,
} as const;

/** Builds the token set every screen reads from one measured palette. */
export function designTheme(p: DesignPalette) {
  const band = p.chrome === 'band';
  return {
    ...semanticShared,
    success: p.success,
    error: p.accent,
    background: p.page,
    backgroundSecondary: p.card,
    surface: p.card,
    surfaceElevated: p.card,
    surfacePressed: p.pressed,
    surfaceSelected: p.accentSoft,
    card: p.card,
    border: p.cardBorder,
    divider: p.divider,
    overlay: withAlpha(p.dark ? BLACK : p.text, p.dark ? 0.6 : 0.45),
    textPrimary: p.text,
    textSecondary: p.textSecondary,
    textMuted: p.textSecondary,
    textDisabled: p.textDisabled,
    sheetBackground: p.card,
    dialogBackground: p.card,
    menuBackground: p.card,
    inputBackground: p.card,
    // The design's one accent: on soft tiles, toggles, primary buttons, section labels.
    primary: p.accent,
    primaryLight: p.accentSoft,
    primaryDark: p.accentPressed,
    accent: p.accent,
    accentSoft: p.accentSoft,
    accentMuted: p.accentMuted,
    track: p.divider,
    switchOff: p.switchOff,
    cardBorder: p.cardBorder,
    textOnPrimary: WHITE,
    /** `band`: a full-width accent header (85 dp, white title) and an accent bottom bar with a white active pill. */
    headerStyle: p.chrome,
    headerBackground: band ? p.accent : p.page,
    headerText: band ? WHITE : p.text,
    headerIcon: band ? WHITE : p.text,
    headerBorder: band ? p.accent : p.page,
    headerSubtitle: band ? withAlpha(WHITE, 0.7) : p.textSecondary,
    headerButtonBackground: band ? withAlpha(WHITE, 0.15) : p.card,
    headerButtonPressed: band ? withAlpha(WHITE, 0.28) : p.pressed,
    headerButtonBorder: band ? 'transparent' : p.cardBorder,
    bottomNavBackground: band ? p.accent : p.card,
    bottomNavActive: band ? WHITE : p.accent,
    bottomNavInactive: band ? withAlpha(WHITE, 0.7) : p.textSecondary,
    bottomNavBorder: band ? p.accent : p.divider,
    bottomNavPressed: band ? withAlpha(WHITE, 0.14) : withAlpha(p.accent, 0.08),
    bottomNavActivePill: band ? withAlpha(WHITE, 0.2) : 'transparent',
    link: p.accent,
    statusBarStyle: (p.dark || band ? 'light' : 'dark') as 'light' | 'dark',
  } as const;
}

/** The six measured palettes, in the PDF's order. */
export const designPalettes = {
  light: {
    page: '#FAF9FB',
    card: '#FFFFFF',
    cardBorder: '#EEEDF1',
    divider: '#EDEDF0',
    accent: '#D92D20',
    accentPressed: '#B8261B',
    accentSoft: '#FDECEA',
    accentMuted: '#F3938C',
    text: '#16161A',
    textSecondary: '#6B6B76',
    textDisabled: '#A9A9B2',
    pressed: '#F3F2F5',
    switchOff: '#D6D5DB',
    success: '#12B76A',
    dark: false,
    chrome: 'flat',
  },
  dark: {
    page: '#121214',
    card: '#1D1D20',
    cardBorder: '#0A0A0B',
    divider: '#2C2C31',
    accent: '#E5382B',
    accentPressed: '#C62F24',
    accentSoft: '#3B1D1B',
    accentMuted: '#F4958D',
    text: '#F4F4F6',
    textSecondary: '#9C9CA6',
    textDisabled: '#6E6E78',
    pressed: '#26262A',
    switchOff: '#46464D',
    success: '#34D399',
    dark: true,
    chrome: 'flat',
  },
  red: {
    page: '#FDF1EF',
    card: '#FFF9F8',
    cardBorder: '#F0D3CF',
    divider: '#F2D8D4',
    accent: '#D92D20',
    accentPressed: '#B8261B',
    accentSoft: '#FBE0DC',
    accentMuted: '#F3938C',
    text: '#2A1210',
    textSecondary: '#8A5E59',
    textDisabled: '#B49B98',
    pressed: '#F8E4E0',
    switchOff: '#D6D5DB',
    success: '#12B76A',
    dark: false,
    chrome: 'band',
  },
  cream: {
    page: '#FBF6EC',
    card: '#FFFDF8',
    cardBorder: '#F1E8D8',
    divider: '#EEE3D0',
    accent: '#C8321F',
    accentPressed: '#A8281A',
    accentSoft: '#F8E3D6',
    accentMuted: '#F1948C',
    text: '#2B2118',
    textSecondary: '#8A7B6A',
    textDisabled: '#B5AA9C',
    pressed: '#F4EDDD',
    switchOff: '#D6D5DB',
    success: '#12B76A',
    dark: false,
    chrome: 'flat',
  },
  midnight: {
    page: '#0D1424',
    card: '#151D31',
    cardBorder: '#060A12',
    divider: '#232D47',
    accent: '#FF4A3D',
    accentPressed: '#E03A2E',
    accentSoft: '#3A1F2B',
    accentMuted: '#F89790',
    text: '#EAF0FF',
    textSecondary: '#8F9BB8',
    textDisabled: '#5F6B88',
    pressed: '#1B2540',
    switchOff: '#3A4565',
    success: '#3DDC97',
    dark: true,
    chrome: 'flat',
  },
  blush: {
    page: '#FFF5F7',
    card: '#FFFFFF',
    cardBorder: '#F8DEE4',
    divider: '#F8DDE3',
    accent: '#E0313F',
    accentPressed: '#C02835',
    accentSoft: '#FFE1E7',
    accentMuted: '#F49490',
    text: '#3A1A22',
    textSecondary: '#94626D',
    textDisabled: '#BFA3AA',
    pressed: '#FBEDF0',
    switchOff: '#D6D5DB',
    success: '#12B76A',
    dark: false,
    chrome: 'flat',
  },
} as const satisfies Record<string, DesignPalette>;

export const colors = {
  light: designTheme(designPalettes.light),
  dark: designTheme(designPalettes.dark),
  red: designTheme(designPalettes.red),
  cream: designTheme(designPalettes.cream),
  midnight: designTheme(designPalettes.midnight),
  blush: designTheme(designPalettes.blush),
} as const;

export type ThemeMode = keyof typeof colors;
export type ColorTokenKey = keyof (typeof colors)['light'];
export type ColorTokens = (typeof colors)[ThemeMode];

/** Primary-tinted interaction surfaces derived from the active primary color. */
export function primaryAlphas(primary: string) {
  return {
    pressed: withAlpha(primary, 0.06),
    subtle: withAlpha(primary, 0.08),
    medium: withAlpha(primary, 0.1),
    strong: withAlpha(primary, 0.12),
    emphasis: withAlpha(primary, 0.18),
  };
}

/** Error-tinted interaction surfaces for destructive affordances. */
export function errorAlphas(error: string) {
  return {
    subtle: withAlpha(error, 0.08),
    medium: withAlpha(error, 0.12),
    strong: withAlpha(error, 0.16),
    emphasis: withAlpha(error, 0.22),
  };
}
