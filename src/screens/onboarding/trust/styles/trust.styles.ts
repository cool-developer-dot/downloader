import { StyleSheet } from 'react-native';

import { TRUST_LAYOUT } from '../constants';

/** Layout-only — colors from useOnboardingSurfaces(). */
export const trustStyles = StyleSheet.create({
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
    flex: 1.2,
    alignItems: 'center',
    justifyContent: 'center',
    minHeight: 300,
    paddingTop: 8,
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
  workflow: {
    width: '100%',
    maxWidth: TRUST_LAYOUT.cardMaxWidth + 40,
    alignSelf: 'center',
    alignItems: 'center',
  },
  chipsRow: {
    flexDirection: 'row',
    flexWrap: 'wrap',
    justifyContent: 'center',
    gap: 8,
    marginTop: 12,
    paddingHorizontal: 4,
    maxWidth: TRUST_LAYOUT.cardMaxWidth + 24,
  },
  libraryZone: {
    width: '100%',
    maxWidth: TRUST_LAYOUT.cardMaxWidth,
    minHeight: 72,
    borderRadius: 16,
    borderWidth: StyleSheet.hairlineWidth + 0.5,
    alignItems: 'center',
    justifyContent: 'flex-end',
    paddingTop: 48,
    paddingBottom: 12,
    paddingHorizontal: 16,
    overflow: 'hidden',
  },
  libraryLabel: {
    fontSize: 11,
    letterSpacing: 1.2,
    textTransform: 'uppercase',
  },
});
