import { StyleSheet } from 'react-native';

import type { IntroColors } from '@/theme';

import { SPLASH_LAYOUT } from '../constants/splash.constants';

export function createSplashStyles(intro: IntroColors) {
  return StyleSheet.create({
    root: {
      flex: 1,
      backgroundColor: intro.background,
    },
    safeArea: {
      flex: 1,
    },
    stage: {
      flex: 1,
      alignItems: 'center',
      justifyContent: 'center',
      paddingHorizontal: 32,
    },
    cluster: {
      alignItems: 'center',
      justifyContent: 'center',
    },
    brandRow: {
      flexDirection: 'row',
      alignItems: 'center',
      justifyContent: 'center',
      marginTop: 28,
    },
    brandLetter: {
      color: intro.brandText,
      fontSize: SPLASH_LAYOUT.brandFontSize,
      lineHeight: SPLASH_LAYOUT.brandFontSize + 8,
      letterSpacing: SPLASH_LAYOUT.brandLetterSpacing,
      fontWeight: '600',
      marginHorizontal: SPLASH_LAYOUT.letterGap,
    },
    taglineRow: {
      flexDirection: 'row',
      alignItems: 'center',
      justifyContent: 'center',
      marginTop: 18,
      gap: 10,
    },
    taglineItem: {
      flexDirection: 'row',
      alignItems: 'center',
      gap: 10,
    },
    taglineWord: {
      color: intro.taglineText,
      fontSize: SPLASH_LAYOUT.taglineFontSize,
      lineHeight: SPLASH_LAYOUT.taglineFontSize + 4,
      letterSpacing: SPLASH_LAYOUT.taglineLetterSpacing,
      fontWeight: '600',
      textTransform: 'uppercase',
    },
    taglineDot: {
      width: 3,
      height: 3,
      borderRadius: 1.5,
      backgroundColor: intro.taglineDot,
    },
  });
}

/** Legacy static styles — LIGHT-neutral fallback; prefer createSplashStyles(intro). */
export const splashStyles = createSplashStyles({
  background: '#FFFFFF',
  brandText: '#171717',
  taglineText: '#525252',
  taglineDot: 'rgba(23, 23, 23, 0.35)',
  loaderTrack: 'rgba(23, 23, 23, 0.12)',
  loaderFill: '#171717',
  muted: '#737373',
  active: '#171717',
  accent: '#171717',
  dotInactive: 'rgba(115, 115, 115, 0.35)',
  statusBarStyle: 'dark-content',
});
