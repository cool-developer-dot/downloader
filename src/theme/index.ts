import { animations } from './animations';
import {
  brandPalette,
  colors,
  errorAlphas,
  primaryAlphas,
  withAlpha,
  type ColorTokenKey,
  type ColorTokens,
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

export const themes = {
  light: {
    colors: colors.light,
    mode: 'light' as const,
    ...sharedTokens,
  },
  logo: {
    colors: colors.logo,
    mode: 'logo' as const,
    ...sharedTokens,
  },
  dark: {
    colors: colors.dark,
    mode: 'dark' as const,
    ...sharedTokens,
  },
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
  normalizeThemePreference,
  resolveThemeMode,
  THEME_PREFERENCES,
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

export type { ColorTokenKey, ColorTokens, ThemeMode };
