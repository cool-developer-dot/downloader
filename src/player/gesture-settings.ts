/**
 * P8 — the gesture settings: Gesture Sensitivity (#586) and Disable Gestures (#587), and which recogniser on the video
 * surface is switched on. Pure (no React, no storage), so the Player screen, the options sheet and the tests share it.
 *
 * - **Gesture controls** (the master switch, the design's screen 20): off switches every gesture below off at once.
 *   Each gesture keeps its own switch underneath, so turning the master back on restores the user's choice.
 * - **Each gesture**: swipe seek (#582), brightness (left edge), volume (right edge), double tap, long press 2× (#545),
 *   two-finger tap (#585) and pinch zoom.
 * - **A single tap is never switched off**: it shows the controls, the only way back to these settings in full screen.
 * - **Sensitivity**: how far a swipe moves the time, the brightness and the volume. Normal is today's mapping exactly
 *   (a factor of 1); Low moves half as far, High twice as far. It never changes when a swipe starts (the 10 / 16 dp
 *   axis lock in `gesture-zones.ts`), only how much the value follows the finger.
 */

export const SWITCHABLE_GESTURES = [
  'swipeSeek',
  'brightness',
  'volume',
  'doubleTap',
  'longPress',
  'twoFingerTap',
  'pinchZoom',
] as const;

export type SwitchableGesture = (typeof SWITCHABLE_GESTURES)[number];

export const GESTURE_SENSITIVITIES = ['low', 'normal', 'high'] as const;

export type GestureSensitivity = (typeof GESTURE_SENSITIVITIES)[number];

/** Normal is 1 so that it is today's mapping bit for bit (`x * 1 === x` for every number). */
export const GESTURE_SENSITIVITY_FACTORS: Readonly<Record<GestureSensitivity, number>> = {
  low: 0.5,
  normal: 1,
  high: 2,
};

export const DEFAULT_GESTURE_SENSITIVITY: GestureSensitivity = 'normal';

export type GestureSettings = {
  /** The master switch ("Gesture controls"). */
  enabled: boolean;
  sensitivity: GestureSensitivity;
} & Record<SwitchableGesture, boolean>;

/**
 * The Player as it was before P8: every gesture it had on, at Normal. The two new ones, swipe seek (#582) and the
 * two-finger tap (#585), are off by default so nothing changes for existing users; they are turned on in
 * ⋮ → Playback → Gestures.
 */
export const DEFAULT_GESTURE_SETTINGS: GestureSettings = {
  enabled: true,
  sensitivity: DEFAULT_GESTURE_SENSITIVITY,
  swipeSeek: false,
  brightness: true,
  volume: true,
  doubleTap: true,
  longPress: true,
  twoFingerTap: false,
  pinchZoom: true,
};

/** The gestures P8 adds; off by default. */
export const NEW_GESTURES_OFF_BY_DEFAULT: readonly SwitchableGesture[] = ['swipeSeek', 'twoFingerTap'];

export function isGestureSensitivity(value: unknown): value is GestureSensitivity {
  return typeof value === 'string' && (GESTURE_SENSITIVITIES as readonly string[]).includes(value);
}

/** A stored value read back: each damaged or missing field falls back to its default on its own. */
export function normalizeGestureSettings(raw: unknown): GestureSettings {
  const source = raw != null && typeof raw === 'object' ? (raw as Record<string, unknown>) : {};
  const flag = (key: 'enabled' | SwitchableGesture): boolean =>
    typeof source[key] === 'boolean' ? (source[key] as boolean) : DEFAULT_GESTURE_SETTINGS[key];
  return {
    enabled: flag('enabled'),
    sensitivity: isGestureSensitivity(source.sensitivity) ? source.sensitivity : DEFAULT_GESTURE_SENSITIVITY,
    swipeSeek: flag('swipeSeek'),
    brightness: flag('brightness'),
    volume: flag('volume'),
    doubleTap: flag('doubleTap'),
    longPress: flag('longPress'),
    twoFingerTap: flag('twoFingerTap'),
    pinchZoom: flag('pinchZoom'),
  };
}

/** A gesture works only while the master switch and its own switch are both on. */
export function gestureOn(settings: GestureSettings, gesture: SwitchableGesture): boolean {
  return settings.enabled && settings[gesture];
}

/** How many gestures work now (0 while the master switch is off), for the options row's value. */
export function gesturesOnCount(settings: GestureSettings): number {
  return SWITCHABLE_GESTURES.filter((gesture) => gestureOn(settings, gesture)).length;
}

/** The factor a swipe's distance is multiplied by; 1 (today's) for anything unknown. */
export function gestureSensitivityFactor(sensitivity: GestureSensitivity | null | undefined): number {
  return isGestureSensitivity(sensitivity) ? GESTURE_SENSITIVITY_FACTORS[sensitivity] : 1;
}

/** A swipe's distance as the brightness / volume / seek maths should see it. Normal returns `translation` itself. */
export function scaleSwipeDistance(translation: number, sensitivity: GestureSensitivity | null | undefined): number {
  return translation * gestureSensitivityFactor(sensitivity);
}

/** What the surface knows besides the settings (all of it existed before P8, except the last two). */
export type SurfaceGestureState = {
  /** Not locked, no sheet open, past the startup cover (the Player screen's `gesturesEnabled`). */
  gesturesEnabled: boolean;
  /** The window brightness can be changed on this device. */
  brightnessAvailable: boolean;
  /** The picture is zoomed (settled). */
  zoomed: boolean;
  /** The surface has a width (the edge zones exist). */
  hasLayout: boolean;
  /** Someone listens for the long press (the Player screen). */
  hasLongPress: boolean;
  /** P8: swipe seek has a listener and the video can seek (ready, length known). */
  canSwipeSeek: boolean;
  /** P8: someone listens for the two-finger tap. */
  hasTwoFingerTap: boolean;
};

/** Which recognisers on the video surface are switched on. */
export type SurfaceGestureFlags = {
  pinch: boolean;
  zoomPan: boolean;
  brightnessPan: boolean;
  volumePan: boolean;
  swipeSeek: boolean;
  doubleTap: boolean;
  /** The double tap may seek or play / pause; while zoomed it only resets the zoom, which belongs to pinch zoom. */
  doubleTapActions: boolean;
  singleTap: boolean;
  longPress: boolean;
  twoFingerTap: boolean;
};

/**
 * The recognisers' `enabled` values. With every switch on, the ones that existed before P8 get exactly the values
 * they had (`gesture-settings.test.ts` checks every combination), so P8 changes nothing until a switch is turned off.
 */
export function surfaceGestureFlags(settings: GestureSettings, state: SurfaceGestureState): SurfaceGestureFlags {
  const { gesturesEnabled, brightnessAvailable, zoomed, hasLayout, hasLongPress, canSwipeSeek, hasTwoFingerTap } = state;
  const doubleTapActions = gestureOn(settings, 'doubleTap');
  return {
    pinch: gesturesEnabled && gestureOn(settings, 'pinchZoom'),
    // Only while zoomed; switching pinch zoom off resets the zoom, so this follows.
    zoomPan: gesturesEnabled && zoomed,
    brightnessPan: gesturesEnabled && brightnessAvailable && !zoomed && hasLayout && gestureOn(settings, 'brightness'),
    volumePan: gesturesEnabled && !zoomed && hasLayout && gestureOn(settings, 'volume'),
    swipeSeek: gesturesEnabled && !zoomed && hasLayout && canSwipeSeek && gestureOn(settings, 'swipeSeek'),
    // While zoomed a double tap still returns the picture to fitted, whatever the double-tap switch says.
    doubleTap: gesturesEnabled && (doubleTapActions || zoomed),
    doubleTapActions,
    singleTap: gesturesEnabled,
    longPress: gesturesEnabled && hasLongPress && gestureOn(settings, 'longPress'),
    twoFingerTap: gesturesEnabled && hasTwoFingerTap && gestureOn(settings, 'twoFingerTap'),
  };
}
