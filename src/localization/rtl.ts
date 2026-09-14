import type { FlexStyle, TextStyle } from 'react-native';

import { resolveLanguage, type SupportedLanguage } from './config';
import { getActiveLanguage } from './translate';

export type RtlLayout = {
  language: SupportedLanguage;
  isRtl: boolean;
  textAlign: TextStyle['textAlign'];
  writingDirection: TextStyle['writingDirection'];
  rowDirection: FlexStyle['flexDirection'];
  start: 'left' | 'right';
  end: 'left' | 'right';
  chevronForward: 'chevron-right' | 'chevron-left';
  chevronBack: 'chevron-left' | 'chevron-right';
  arrowBack: 'arrow-left' | 'arrow-right';
  arrowForward: 'arrow-right' | 'arrow-left';
};

/**
 * Live RTL helpers. Native layout-direction forcing is not used — that would
 * require an app restart on the current React Native / Expo stack. Direction
 * is applied through text alignment, writingDirection, and opt-in row
 * mirroring instead.
 */
export function getRtlLayout(
  language: SupportedLanguage | string = getActiveLanguage(),
): RtlLayout {
  const resolved = resolveLanguage(language);
  const isRtl = resolved === 'ur';

  return {
    language: resolved,
    isRtl,
    textAlign: isRtl ? 'right' : 'left',
    writingDirection: isRtl ? 'rtl' : 'ltr',
    rowDirection: isRtl ? 'row-reverse' : 'row',
    start: isRtl ? 'right' : 'left',
    end: isRtl ? 'left' : 'right',
    chevronForward: isRtl ? 'chevron-left' : 'chevron-right',
    chevronBack: isRtl ? 'chevron-right' : 'chevron-left',
    arrowBack: isRtl ? 'arrow-right' : 'arrow-left',
    arrowForward: isRtl ? 'arrow-left' : 'arrow-right',
  };
}

export function resolveDirectionalIcon(
  ltrIcon: 'chevron-right' | 'chevron-left' | 'arrow-left' | 'arrow-right',
  rtl: Pick<RtlLayout, 'isRtl'>,
): typeof ltrIcon {
  if (!rtl.isRtl) {
    return ltrIcon;
  }

  switch (ltrIcon) {
    case 'chevron-right':
      return 'chevron-left';
    case 'chevron-left':
      return 'chevron-right';
    case 'arrow-left':
      return 'arrow-right';
    case 'arrow-right':
      return 'arrow-left';
    default:
      return ltrIcon;
  }
}

export function startEndStyle(
  rtl: Pick<RtlLayout, 'isRtl'>,
  start: number,
  end = 0,
): { paddingLeft: number; paddingRight: number } {
  return rtl.isRtl
    ? { paddingLeft: end, paddingRight: start }
    : { paddingLeft: start, paddingRight: end };
}

export function marginStartStyle(
  rtl: Pick<RtlLayout, 'isRtl'>,
  start: number,
): { marginLeft?: number; marginRight?: number } {
  return rtl.isRtl ? { marginRight: start } : { marginLeft: start };
}
