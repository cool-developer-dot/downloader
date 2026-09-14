/**
 * Player chrome features verification — orientation, mute, speed.
 * Run: npx tsx scripts/verify-player-chrome-features.ts
 */
// eslint-disable-next-line @typescript-eslint/no-explicit-any
const fs = require('fs') as any;
// eslint-disable-next-line @typescript-eslint/no-explicit-any
const path = require('path') as any;
// eslint-disable-next-line @typescript-eslint/no-explicit-any
declare const __dirname: any;
// eslint-disable-next-line @typescript-eslint/no-explicit-any
declare const process: any;

import {
  DEFAULT_PLAYBACK_RATE,
  PLAYBACK_RATES,
  applyMute,
  applyUnmute,
  applyVolumeChange,
  createInitialVolumeState,
  isValidOrientationMode,
  isValidPlaybackRate,
  normalizePlaybackRate,
  orientationForFullscreen,
  resolveAndroidBackAction,
  resolveVolumeIcon,
} from '../src/player';

let passed = 0;
let failed = 0;

function assert(condition: boolean, message: string): void {
  if (!condition) {
    failed += 1;
    console.error(`FAIL: ${message}`);
    return;
  }
  passed += 1;
  console.log(`PASS: ${message}`);
}

function read(rel: string): string {
  return fs.readFileSync(path.join(__dirname, '..', rel), 'utf8');
}

assert(DEFAULT_PLAYBACK_RATE === 1, 'default playback rate is 1x');
assert(
  PLAYBACK_RATES.length === 7 && PLAYBACK_RATES.includes(1.75),
  'supported rate list includes 1.75x',
);
assert(isValidPlaybackRate(1.5), '1.5x is valid rate');
assert(normalizePlaybackRate(1.75) === 1.75, '1.75x normalizes');

const playerScreen = read('src/screens/player/PlayerScreen.tsx');
const volumeHook = read('src/player/hooks/use-player-volume.ts');
const orientationHook = read('src/player/hooks/use-player-orientation.ts');
const playerControls = read('src/screens/player/components/PlayerControls.tsx');

assert(playerScreen.includes('setPlaybackRate(rate)'), 'rate updates canonical player rate');
assert(playerScreen.includes('isFullscreen'), 'fullscreen state wired');
assert(playerScreen.includes('usePlayerOrientation'), 'orientation hook wired');
assert(playerScreen.includes('orientationSheetOpen'), 'orientation sheet state');
assert(playerScreen.includes('volume.toggleMute'), 'mute uses system volume on Android');

let muteState = createInitialVolumeState(0.68);
muteState = applyMute(muteState);
assert(muteState.isMuted && muteState.previousNonZeroVolume === 0.68, 'mute sets volume to zero');
muteState = applyUnmute(muteState);
assert(!muteState.isMuted && muteState.volume === 0.68, 'unmute restores previous volume');

const unmuteFromGesture = applyVolumeChange(createInitialVolumeState(0), 0.42);
assert(unmuteFromGesture?.volume === 0.42 && !unmuteFromGesture.isMuted, 'increasing volume from mute un-mutes');

assert(isValidOrientationMode('auto'), 'orientation auto valid');
assert(isValidOrientationMode('portrait'), 'portrait selection valid');
assert(isValidOrientationMode('landscape'), 'landscape selection valid');
assert(orientationForFullscreen('portrait') === 'portrait', 'portrait stays portrait in fullscreen');
assert(orientationForFullscreen('auto') === 'landscape', 'auto fullscreen prefers landscape');

assert(resolveVolumeIcon(0, true) === 'volume-off', 'mute icon at 0%');
assert(resolveVolumeIcon(0.2) === 'volume-low', 'low volume icon');
assert(resolveVolumeIcon(0.55) === 'volume-medium', 'medium volume icon');
assert(resolveVolumeIcon(0.9) === 'volume-high', 'high volume icon');

assert(volumeHook.includes('previousNonZeroRef'), 'previous volume stored for unmute');
assert(volumeHook.includes('toggleMute'), 'volume hook exposes toggleMute');
assert(orientationHook.includes('applyOrientationMode'), 'orientation applies lock');
assert(playerControls.includes('resolveVolumeIcon'), 'controls use tiered volume icons');
assert(
  playerControls.includes("color={controlsDisabled ? 'disabled' : 'inverse'}"),
  'mute/±10/speed icons use inverse on black video (all themes)',
);
assert(
  read('src/screens/player/components/PlayerTopBar.tsx').includes('color="inverse"'),
  'top-bar icons use inverse on dark chrome',
);
assert(
  read('src/screens/player/components/PlayerAdjustmentHud.tsx').includes(
    'color="inverse"',
  ),
  'brightness/volume HUD icon uses inverse (not LIGHT primary ink)',
);
assert(playerScreen.includes('setSpeedSheetOpen(false)'), 'back closes speed sheet first');
assert(playerScreen.includes('setOrientationSheetOpen(false)'), 'back closes orientation sheet first');
assert(resolveAndroidBackAction(true) === 'exit_fullscreen', 'back exits fullscreen before leaving screen');
assert(!playerScreen.includes('key={mediaId}'), 'player source unchanged across settings changes');

console.log(`\nPlayer chrome features: ${passed} passed, ${failed} failed`);
process.exit(failed > 0 ? 1 : 0);
