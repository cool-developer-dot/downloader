/**
 * P8 Gestures & custom controls — its rows in the options sheet.
 *
 * Playback (P8 uses 100–190; P1 has 10–40, P5 / P6 50–90): Gestures 100 (opens the Gestures sheet: screen 20's card,
 * the master switch, each gesture, the sensitivity), Gesture controls 110 (the master switch, #587), Gesture
 * sensitivity 120 (#586). Tools (P8 uses 80–89): Customize controls 80 (#692). Screen 25 ("Player settings") does not
 * show where Customize controls goes, so it is under Tools.
 */

import { gestureSensitivityLabel } from '../gesture-settings-labels';

import { playerOptions, type PlayerOptionContext, type PlayerOptionDefinition } from './player-options';

export const P8_OWNER = 'P8';

/** "All on", "5 of 7 on" or "Off". */
export function gesturesSummary(ctx: PlayerOptionContext): string {
  const { enabled, onCount, total } = ctx.gestures;
  if (!enabled || onCount === 0) {
    return ctx.t('videoPlayer.gesturesValueOff');
  }
  if (onCount >= total) {
    return ctx.t('videoPlayer.gesturesValueAll');
  }
  return ctx.t('videoPlayer.gesturesValueSome', { on: onCount, total });
}

export const P8_PLAYER_OPTIONS: readonly PlayerOptionDefinition[] = [
  {
    id: 'p8.gestures',
    section: 'playback',
    order: 100,
    label: 'videoPlayer.gestures',
    subtitle: 'videoPlayer.gesturesHint',
    icon: 'sliders-horizontal',
    value: gesturesSummary,
    onPress: (ctx) => ctx.ui.openGestures(),
  },
  {
    id: 'p8.gestureControls',
    section: 'playback',
    order: 110,
    label: 'videoPlayer.gestureControls',
    subtitle: 'videoPlayer.gestureControlsHint',
    icon: 'circle-dot',
    toggle: (ctx) => ctx.gestures.enabled,
    onPress: (ctx) => ctx.ui.setGesturesEnabled(!ctx.gestures.enabled),
  },
  {
    id: 'p8.gestureSensitivity',
    section: 'playback',
    order: 120,
    label: 'videoPlayer.gestureSensitivity',
    icon: 'gauge',
    value: (ctx) => gestureSensitivityLabel(ctx.t, ctx.gestures.sensitivity),
    onPress: (ctx) => ctx.ui.openGestureSensitivity(),
  },
  {
    id: 'p8.customizeControls',
    section: 'tools',
    order: 80,
    label: 'videoPlayer.customizeControls',
    subtitle: 'videoPlayer.customizeControlsHint',
    icon: 'layout-grid',
    onPress: (ctx) => ctx.ui.openCustomizeControls(),
  },
];

playerOptions.register(P8_OWNER, P8_PLAYER_OPTIONS);
