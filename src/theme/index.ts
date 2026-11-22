import { animations } from './animations';
import {
  brandPalette,
  colors,
  designPalettes,
  designTheme,
  errorAlphas,
  primaryAlphas,
  withAlpha,
  type ColorTokenKey,
  type ColorTokens,
  type DesignPalette,
  type ThemeMode,
} from './colors';
import { elevation } from './elevation';
import { iconColors, icons } from './icons';
import { opacity } from './opacity';
import { radius } from './radius';
import { spacing } from './spacing';
import { typography } from './typography';

const sharedTokens = {
  spacing,
  typography,
  radius,
  elevation,
  animations,
  icons,
  iconColors,
  opacity,
} as const;

function buildTheme<M extends ThemeMode>(mode: M) {
  return { colors: colors[mode], mode, ...sharedTokens } as const;
}

/** One theme object per design theme (the PDF's order). */
export const themes = {
  light: buildTheme('light'),
  dark: buildTheme('dark'),
  red: buildTheme('red'),
  cream: buildTheme('cream'),
  midnight: buildTheme('midnight'),
  blush: buildTheme('blush'),
} as const;

export type Theme = {
  colors: ColorTokens;
  mode: ThemeMode;
  spacing: typeof spacing;
  typography: typeof typography;
  radius: typeof radius;
  elevation: typeof elevation;
  animations: typeof animations;
  icons: typeof icons;
  iconColors: typeof iconColors;
  opacity: typeof opacity;
};

export {
  animations,
  brandPalette,
  colors,
  designPalettes,
  designTheme,
  elevation,
  errorAlphas,
  iconColors,
  icons,
  opacity,
  primaryAlphas,
  radius,
  spacing,
  typography,
  withAlpha,
};

export { applyNativeColorScheme } from './apply-native-color-scheme';
export {
  isDarkThemeMode,
  normalizeThemePreference,
  resolveThemeMode,
  THEME_PREFERENCES,
  type ThemePreference,
} from './theme-preference';
export { resolveIntroColors, type IntroColors } from './intro-palette';
export {
  resolveOnboardingSurfaces,
  DARK_ONBOARDING_ALLOWLIST,
  type OnboardingSurfaces,
} from './onboarding-surfaces';
export {
  resolvePersistedThemeMode,
  resolveStartupBackground,
  resolveStartupIntroBackground,
} from './startup-theme';
export { contrastRatio, relativeLuminance, roundContrast } from './contrast';

export type { ColorTokenKey, ColorTokens, DesignPalette, ThemeMode };
