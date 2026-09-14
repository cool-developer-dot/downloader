import {
  MD3DarkTheme,
  MD3LightTheme,
  configureFonts,
  type MD3Theme,
} from 'react-native-paper';
import { type TextStyle } from 'react-native';

import { colors, radius, typography, type ThemeMode } from '@/theme';
import { fontFamilies, fontWeights } from '@/theme/typography';

type PaperFont = {
  fontFamily: string;
  fontSize: number;
  lineHeight: number;
  fontWeight: '400' | '600';
  letterSpacing: number;
};

function toPaperFont(
  style: TextStyle,
  fallbackFamily: string,
  weight: '400' | '600' = fontWeights.regular,
): PaperFont {
  return {
    fontFamily: style.fontFamily ?? fallbackFamily,
    fontSize: style.fontSize ?? typography.body.fontSize ?? 16,
    lineHeight: style.lineHeight ?? typography.body.lineHeight ?? 24,
    fontWeight: weight,
    letterSpacing: 0,
  };
}

function createFontConfig() {
  return configureFonts({
    config: {
      displayLarge: toPaperFont(typography.display, fontFamilies.heading, fontWeights.semiBold),
      displayMedium: toPaperFont(typography.h1, fontFamilies.heading, fontWeights.semiBold),
      displaySmall: toPaperFont(typography.h2, fontFamilies.heading, fontWeights.semiBold),
      headlineLarge: toPaperFont(typography.h3, fontFamilies.heading, fontWeights.semiBold),
      headlineMedium: toPaperFont(typography.title, fontFamilies.heading, fontWeights.semiBold),
      headlineSmall: toPaperFont(typography.subtitle, fontFamilies.heading, fontWeights.semiBold),
      titleLarge: toPaperFont(typography.title, fontFamilies.heading, fontWeights.semiBold),
      titleMedium: toPaperFont(typography.subtitle, fontFamilies.heading, fontWeights.semiBold),
      titleSmall: toPaperFont(typography.label, fontFamilies.bodySemiBold, fontWeights.semiBold),
      bodyLarge: toPaperFont(typography.body, fontFamilies.body, fontWeights.regular),
      bodyMedium: toPaperFont(typography.bodySmall, fontFamilies.body, fontWeights.regular),
      bodySmall: toPaperFont(typography.caption, fontFamilies.body, fontWeights.regular),
      labelLarge: toPaperFont(typography.button, fontFamilies.bodySemiBold, fontWeights.semiBold),
      labelMedium: toPaperFont(typography.label, fontFamilies.bodySemiBold, fontWeights.semiBold),
      labelSmall: toPaperFont(typography.caption, fontFamilies.body, fontWeights.regular),
    },
  });
}

export function createPaperTheme(mode: ThemeMode): MD3Theme {
  const palette = colors[mode];
  const base = mode === 'dark' ? MD3DarkTheme : MD3LightTheme;

  return {
    ...base,
    roundness: radius.md,
    fonts: createFontConfig(),
    colors: {
      ...base.colors,
      primary: palette.primary,
      onPrimary: palette.textOnPrimary,
      primaryContainer: palette.primaryLight,
      onPrimaryContainer: palette.textPrimary,
      secondary: palette.accent,
      onSecondary: palette.textOnPrimary,
      secondaryContainer: palette.surface,
      onSecondaryContainer: palette.textPrimary,
      tertiary: palette.info,
      onTertiary: palette.white,
      tertiaryContainer: palette.surface,
      onTertiaryContainer: palette.textPrimary,
      error: palette.error,
      onError: palette.white,
      errorContainer: palette.surface,
      onErrorContainer: palette.error,
      background: palette.background,
      onBackground: palette.textPrimary,
      surface: palette.surface,
      onSurface: palette.textPrimary,
      surfaceVariant: palette.card,
      onSurfaceVariant: palette.textSecondary,
      outline: palette.border,
      outlineVariant: palette.divider,
      inverseSurface: palette.textPrimary,
      inverseOnSurface: palette.background,
      inversePrimary: palette.primaryLight,
      elevation: {
        ...base.colors.elevation,
        level0: palette.background,
        level1: palette.surface,
        level2: palette.card,
        level3: palette.card,
        level4: palette.card,
        level5: palette.card,
      },
      surfaceDisabled: palette.textDisabled,
      onSurfaceDisabled: palette.textDisabled,
      backdrop: palette.overlay,
    },
  };
}
