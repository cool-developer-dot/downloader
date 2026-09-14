/**
 * VidoraX design tokens.
 *
 * Content modes:
 * - light — WHITE + BLACK + GRAY (DEFAULT). No sage/green brand identity.
 * - logo — white/neutral content + canonical brand-red chrome
 * - dark — BLACK + CHARCOAL + WHITE + GRAY private app (no olive/sage brand)
 *
 * Canonical brand red (Logo only):
 * - HEX: #DC3C2C
 * - Source: assets/logos/vidorax-logo.png
 *
 * Green appears ONLY via semantic `success` (completed/positive status).
 * Olive/sage raw literals may remain in the palette reservoir for historical assets
 * but must NOT map into light/logo/dark tokens or startup intro/onboarding surfaces.
 * Sage is NOT used as Light primary / Dark private-app primary.
 */

const palette = {
  /**
   * Legacy olive/sage reservoir — historical / native splash asset only.
   * Must NOT map into private-app `colors.dark` or intro continuity surfaces.
   */
  sagePrimary: '#ACC8A2',
  sageLight: '#C5D9BE',
  sageDark: '#8FB583',
  sageMuted: '#7A9470',
  deepOlive: '#1A2517',
  oliveSurface: '#222E1E',
  oliveCard: '#2A3824',
  oliveElevated: '#314030',
  oliveBorder: '#3A4A35',
  oliveBorderSubtle: '#2E3D28',
  oliveInput: '#252F21',

  /** Canonical VidoraX brand red — from logo asset sampling. */
  brandRed: '#DC3C2C',
  brandRedPressed: '#C43426',
  brandRedMuted: '#F2A39C',
  brandRedSoft: '#FCE8E6',
  onBrandRed: '#FFFFFF',

  /** Neutral light surfaces (Light + Logo content). */
  neutralWhite: '#FFFFFF',
  neutralBg: '#FAFAFA',
  neutralSurface: '#FFFFFF',
  neutralElevated: '#FFFFFF',
  neutralPressed: '#F5F5F5',
  neutralSelected: '#F3F4F6',
  neutralBorder: '#E5E5E5',
  neutralDivider: '#EEEEEE',
  neutralInputBorder: '#DADADA',

  /** Light generic primary = dark neutral (NOT sage/green). */
  ink: '#171717',
  inkStrong: '#111111',
  inkMuted: '#F3F4F6',

  textPrimaryLight: '#171717',
  textSecondaryLight: '#6B7280',
  textMutedLight: '#737373',
  textDisabledLight: '#A3A3A3',

  /** Neutral Dark private-app surfaces (NOT olive). */
  darkBg: '#0D0D0D',
  darkBgSecondary: '#141414',
  darkSurface: '#181818',
  darkElevated: '#1F1F1F',
  darkPressed: '#262626',
  darkSelected: '#242424',
  darkBorder: '#2A2A2A',
  darkDivider: '#242424',
  darkInputBorder: '#333333',
  darkChrome: '#0F0F0F',
  darkTextPrimary: '#F5F5F5',
  darkTextSecondary: '#B3B3B3',
  darkTextMuted: '#8A8A8A',
  darkTextDisabled: '#666666',
  /** Dark generic primary = off-white (NOT sage/green). */
  darkPrimary: '#F5F5F5',
  darkOnPrimary: '#171717',
  darkPrimaryMuted: '#262626',
  darkPrimaryStrong: '#FFFFFF',

  /** Semantic status — success green is NOT theme brand identity. */
  success: '#16A34A',
  error: '#EF4444',
  warning: '#D97706',
  info: '#5B9AA9',

  white: '#FFFFFF',
  black: '#000000',
} as const;

export const brandPalette = {
  brandRed: palette.brandRed,
  brandRedPressed: palette.brandRedPressed,
  brandRedMuted: palette.brandRedMuted,
  brandRedSoft: palette.brandRedSoft,
  onBrandRed: palette.onBrandRed,
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

const semanticShared = {
  success: palette.success,
  warning: palette.warning,
  error: palette.error,
  info: palette.info,
  white: palette.white,
  black: palette.black,
} as const;

/** White / near-white content shared by Light + Logo main surfaces. */
const lightContent = {
  background: palette.neutralWhite,
  backgroundSecondary: palette.neutralBg,
  surface: palette.neutralSurface,
  surfaceElevated: palette.neutralElevated,
  surfacePressed: palette.neutralPressed,
  surfaceSelected: palette.neutralSelected,
  card: palette.neutralWhite,
  border: palette.neutralBorder,
  divider: palette.neutralDivider,
  overlay: withAlpha(palette.black, 0.45),
  textPrimary: palette.textPrimaryLight,
  textSecondary: palette.textSecondaryLight,
  textMuted: palette.textMutedLight,
  textDisabled: palette.textDisabledLight,
  sheetBackground: palette.neutralWhite,
  dialogBackground: palette.neutralWhite,
  menuBackground: palette.neutralWhite,
  inputBackground: palette.neutralWhite,
} as const;

export const colors = {
  light: {
    ...semanticShared,
    ...lightContent,
    // Generic Light primary = dark neutral. Success green is separate.
    primary: palette.ink,
    primaryLight: palette.inkMuted,
    primaryDark: palette.inkStrong,
    accent: palette.ink,
    textOnPrimary: palette.white,
    headerBackground: palette.neutralWhite,
    headerText: palette.textPrimaryLight,
    headerIcon: palette.ink,
    headerBorder: palette.neutralDivider,
    headerSubtitle: palette.textSecondaryLight,
    bottomNavBackground: palette.neutralWhite,
    bottomNavActive: palette.ink,
    bottomNavInactive: palette.textSecondaryLight,
    bottomNavBorder: palette.neutralDivider,
    bottomNavPressed: withAlpha(palette.ink, 0.08),
    link: palette.ink,
    statusBarStyle: 'dark' as const,
  },
  logo: {
    ...semanticShared,
    ...lightContent,
    primary: palette.brandRed,
    primaryLight: palette.brandRedMuted,
    primaryDark: palette.brandRedPressed,
    accent: palette.brandRed,
    textOnPrimary: palette.onBrandRed,
    headerBackground: palette.brandRed,
    headerText: palette.onBrandRed,
    headerIcon: palette.onBrandRed,
    headerBorder: palette.brandRedPressed,
    headerSubtitle: withAlpha(palette.onBrandRed, 0.6),
    bottomNavBackground: palette.brandRed,
    bottomNavActive: palette.onBrandRed,
    // Muted on-red (~60%): disabled glyphs stay visible on #DC3C2C, distinct from white active.
    bottomNavInactive: withAlpha(palette.onBrandRed, 0.6),
    bottomNavBorder: palette.brandRedPressed,
    bottomNavPressed: withAlpha(palette.onBrandRed, 0.14),
    link: palette.brandRed,
    statusBarStyle: 'light' as const,
  },
  dark: {
    ...semanticShared,
    background: palette.darkBg,
    backgroundSecondary: palette.darkBgSecondary,
    surface: palette.darkSurface,
    surfaceElevated: palette.darkElevated,
    surfacePressed: palette.darkPressed,
    surfaceSelected: palette.darkSelected,
    card: palette.darkSurface,
    border: palette.darkBorder,
    divider: palette.darkDivider,
    overlay: withAlpha(palette.black, 0.6),
    textPrimary: palette.darkTextPrimary,
    textSecondary: palette.darkTextSecondary,
    textMuted: palette.darkTextMuted,
    textDisabled: palette.darkTextDisabled,
    sheetBackground: palette.darkSurface,
    dialogBackground: palette.darkSurface,
    menuBackground: palette.darkElevated,
    inputBackground: palette.darkSurface,
    // Generic Dark primary = off-white. Success green is separate. No sage.
    primary: palette.darkPrimary,
    primaryLight: palette.darkPrimaryMuted,
    primaryDark: palette.darkPrimaryStrong,
    accent: palette.darkPrimary,
    textOnPrimary: palette.darkOnPrimary,
    headerBackground: palette.darkChrome,
    headerText: palette.darkTextPrimary,
    headerIcon: palette.darkPrimary,
    headerBorder: palette.darkDivider,
    headerSubtitle: palette.darkTextSecondary,
    bottomNavBackground: palette.darkChrome,
    bottomNavActive: palette.darkPrimaryStrong,
    bottomNavInactive: palette.darkTextMuted,
    bottomNavBorder: palette.darkPressed,
    bottomNavPressed: withAlpha(palette.white, 0.12),
    link: palette.darkPrimary,
    statusBarStyle: 'light' as const,
  },
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
