/**
 * Player adjustment HUD verification.
 * Run: npx tsx scripts/verify-player-level-controls.ts
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
  clampBrightness,
  brightnessFromSwipe,
  levelToPercent,
} from '../src/player/brightness-state';
import { levelFromSwipeDelta } from '../src/player/level-gesture';
import { clampVolume } from '../src/player/volume-state';

const ADJUSTMENT_HUD_HIDE_MS = 1200;

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

assert(clampBrightness(1.5) === 1, 'brightness clamp max');
assert(clampBrightness(-0.2) === 0, 'brightness clamp min');
assert(clampVolume(2) === 1, 'volume clamp max');
assert(clampVolume(-1) === 0, 'volume clamp min');

const start = 0.5;
const up = levelFromSwipeDelta(start, -120, 240, clampBrightness);
const down = levelFromSwipeDelta(start, 120, 240, clampBrightness);
assert(up > start, 'swipe up increases brightness');
assert(down < start, 'swipe down decreases brightness');

assert(levelToPercent(0) === 0, '0 volume percent');
assert(levelToPercent(0.72) === 72, '72 percent formatting');

const playerScreen = read('src/screens/player/PlayerScreen.tsx');
const surface = read('src/screens/player/components/PlayerVideoSurface.tsx');
const hud = read('src/screens/player/components/PlayerAdjustmentHud.tsx');
const sideGestures = read('src/player/use-player-side-gestures.ts');
const volumeHook = read('src/player/hooks/use-player-volume.ts');

assert(
  sideGestures.includes('ADJUSTMENT_HUD_HIDE_MS = 1200'),
  'HUD auto-hide timer ~1.2s',
);

assert(playerScreen.includes('PlayerAdjustmentHud'), 'PlayerScreen mounts adjustment HUD');
assert(!playerScreen.includes('PlayerSideLevelControls'), 'permanent side bars removed');
assert(!playerScreen.includes('PlayerVerticalLevelControl'), 'permanent vertical controls removed');
assert(surface.includes('onBrightnessPanBegin'), 'left side brightness gesture zone restored');
assert(surface.includes('onVolumePanBegin'), 'right side volume gesture zone restored');
assert(hud.includes('volume-off'), 'mute icon at 0% volume');
assert(hud.includes('brightness-'), 'brightness icon present');
assert(
  hud.includes('color="inverse"'),
  'HUD glyph is inverse white — visible in LIGHT/LOGO/DARK',
);
assert(!hud.includes('color="primary"'), 'HUD does not use theme primary on dark scrim');
assert(!hud.includes('minHeight: 148'), 'HUD has no permanent slider track');
assert(sideGestures.includes('showHud'), 'gesture shows temporary HUD');
assert(sideGestures.includes('scheduleHide'), 'HUD auto-hide scheduled after gesture');
assert(volumeHook.includes('subscribeAndroidMediaVolume'), 'physical volume sync wired');

try {
  read('src/screens/player/components/PlayerSideLevelControls.tsx');
  assert(false, 'PlayerSideLevelControls deleted');
} catch {
  assert(true, 'PlayerSideLevelControls deleted');
}

console.log(`\nPlayer adjustment HUD: ${passed} passed, ${failed} failed`);
process.exit(failed > 0 ? 1 : 0);
