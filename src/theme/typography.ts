// Per-weight entry points: the packages' index files require every weight (36 TTFs in the APK); only 3 are used.
import { Inter_400Regular } from '@expo-google-fonts/inter/400Regular';
import { Inter_600SemiBold } from '@expo-google-fonts/inter/600SemiBold';
import { Poppins_600SemiBold } from '@expo-google-fonts/poppins/600SemiBold';
import { Platform, TextStyle } from 'react-native';

type FontRole = 'heading' | 'body' | 'bodySemiBold';
type FontFamilyMap = Record<FontRole, string>;

export const webFontFamilies: FontFamilyMap = {
  heading: 'Poppins',
  body: 'Inter',
  bodySemiBold: 'Inter',
};

export const nativeFontFamilies: FontFamilyMap = {
  heading: 'Poppins_600SemiBold',
  body: 'Inter_400Regular',
  bodySemiBold: 'Inter_600SemiBold',
};

export const fontFamilies = Platform.select({
  web: webFontFamilies,
  default: nativeFontFamilies,
}) as FontFamilyMap;

export const appFontAssets = {
  [nativeFontFamilies.heading]: Poppins_600SemiBold,
  [nativeFontFamilies.body]: Inter_400Regular,
  [nativeFontFamilies.bodySemiBold]: Inter_600SemiBold,
} as const;

export const fontWeights = {
  regular: '400',
  semiBold: '600',
} as const;

export const fontSizes = {
  display: 40,
  h1: 32,
  h2: 28,
  h3: 24,
  title: 20,
  subtitle: 18,
  body: 16,
  bodySmall: 14,
  caption: 12,
  button: 16,
  label: 14,
} as const;

export const lineHeights = {
  display: 48,
  h1: 40,
  h2: 36,
  h3: 32,
  title: 28,
  subtitle: 26,
  body: 24,
  bodySmall: 20,
  caption: 16,
  button: 24,
  label: 20,
} as const;

type TypographySizeVariant = keyof typeof fontSizes;

function getFontFamily(role: FontRole): string {
  return Platform.select({
    web: webFontFamilies[role],
    default: nativeFontFamilies[role],
  })!;
}

function getWebFontWeight(role: FontRole): TextStyle['fontWeight'] {
  if (role === 'body') {
    return fontWeights.regular;
  }

  return fontWeights.semiBold;
}

function createHeadingStyle(variant: TypographySizeVariant): TextStyle {
  return {
    fontFamily: getFontFamily('heading'),
    fontSize: fontSizes[variant],
    lineHeight: lineHeights[variant],
    ...Platform.select({
      web: { fontWeight: getWebFontWeight('heading') },
      default: {},
    }),
  };
}

function createBodyStyle(variant: TypographySizeVariant, role: Extract<FontRole, 'body' | 'bodySemiBold'>): TextStyle {
  return {
    fontFamily: getFontFamily(role),
    fontSize: fontSizes[variant],
    lineHeight: lineHeights[variant],
    ...Platform.select({
      web: { fontWeight: getWebFontWeight(role) },
      default: {},
    }),
  };
}

export const typography = {
  display: createHeadingStyle('display'),
  h1: createHeadingStyle('h1'),
  h2: createHeadingStyle('h2'),
  h3: createHeadingStyle('h3'),
  title: createHeadingStyle('title'),
  subtitle: createHeadingStyle('subtitle'),
  body: createBodyStyle('body', 'body'),
  bodySmall: createBodyStyle('bodySmall', 'body'),
  caption: createBodyStyle('caption', 'body'),
  button: createBodyStyle('button', 'bodySemiBold'),
  label: createBodyStyle('label', 'bodySemiBold'),
} as const satisfies Record<string, TextStyle>;

export type TypographyVariant = keyof typeof typography;
