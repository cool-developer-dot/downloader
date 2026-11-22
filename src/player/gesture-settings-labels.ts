/**
 * P8: the words for the gesture sensitivities, shared by the options sheet rows and the Player's sheets.
 */

import type { TranslateFn, TranslationKey } from '@/localization';

import type { GestureSensitivity } from './gesture-settings';

export const GESTURE_SENSITIVITY_LABELS: Readonly<Record<GestureSensitivity, TranslationKey>> = {
  low: 'videoPlayer.gestureSensitivityLow',
  normal: 'videoPlayer.gestureSensitivityNormal',
  high: 'videoPlayer.gestureSensitivityHigh',
};

/** "Low", "Normal", "High". */
export function gestureSensitivityLabel(t: TranslateFn, sensitivity: GestureSensitivity): string {
  return t(GESTURE_SENSITIVITY_LABELS[sensitivity]);
}
