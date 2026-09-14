import { StyleSheet } from 'react-native';

import { LIBRARY_LAYOUT } from '../constants';

/** Layout-only — colors from useOnboardingSurfaces(). */
export const libraryStyles = StyleSheet.create({
  root: {
    flex: 1,
  },
  safe: {
    flex: 1,
  },
  body: {
    flex: 1,
    paddingHorizontal: 24,
  },
  hero: {
    flex: 1.25,
    alignItems: 'center',
    justifyContent: 'center',
    minHeight: 300,
    paddingTop: 4,
  },
  copy: {
    paddingBottom: 8,
    alignItems: 'center',
  },
  title: {
    fontSize: 28,
    lineHeight: 36,
    fontWeight: '600',
    letterSpacing: 0.15,
    textAlign: 'center',
  },
  subtitle: {
    marginTop: 12,
    fontSize: 14,
    lineHeight: 21,
    textAlign: 'center',
    maxWidth: 340,
  },
  canvas: {
    width: '100%',
    maxWidth: LIBRARY_LAYOUT.canvasMax,
    aspectRatio: 1.05,
    alignSelf: 'center',
    alignItems: 'center',
    justifyContent: 'center',
  },
});
