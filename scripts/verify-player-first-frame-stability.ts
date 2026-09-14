/**
 * Player first-frame stability — cover until composition-synced reveal.
 * Run: npm run verify:player-first-frame-stability
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
  applyFirstFrameAccepted,
  applySurfaceReveal,
  canAcceptFirstFrameEvent,
  initialPlayerSessionState,
  isCurrentPlayerSession,
  resetFirstFrameForNewSource,
  scheduleCompositionSyncedReveal,
  shouldAssignPlaybackSource,
  shouldRevealSurfaceInSameTurnAsFirstFrameEvent,
  shouldShowStartupCover,
  shouldShowStartupCoverWhileBuffering,
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

console.log('Player first-frame stability verifier\n');

// ─── Pure first-frame / reveal helpers ──────────────────────────────────────

assert(
  initialPlayerSessionState.hasFirstFrame === false,
  'session starts without first frame',
);
assert(
  initialPlayerSessionState.isSurfaceRevealed === false,
  'session starts with surface unrevealed',
);

assert(
  shouldRevealSurfaceInSameTurnAsFirstFrameEvent() === false,
  'first frame does not immediately reveal surface in same turn',
);

assert(
  shouldShowStartupCover({ isSurfaceRevealed: false, hasError: false }) ===
    true,
  'cover shown before composition-synced reveal',
);
assert(
  shouldShowStartupCover({ isSurfaceRevealed: true, hasError: false }) ===
    false,
  'cover hidden only after surface reveal',
);
assert(
  shouldShowStartupCover({ isSurfaceRevealed: false, hasError: true }) ===
    false,
  'error exits cover (stable error UI, not black)',
);

const afterFirstFrame = applyFirstFrameAccepted({
  hasFirstFrame: false,
  isSurfaceRevealed: false,
});
assert(afterFirstFrame.hasFirstFrame === true, 'first frame accepted');
assert(
  afterFirstFrame.isSurfaceRevealed === false,
  'accepting first frame keeps cover opaque (no same-turn reveal)',
);
assert(
  shouldShowStartupCover({
    isSurfaceRevealed: afterFirstFrame.isSurfaceRevealed,
    hasError: false,
  }) === true,
  'cover still visible after first-frame event before composition sync',
);

const afterReveal = applySurfaceReveal(afterFirstFrame);
assert(afterReveal.isSurfaceRevealed === true, 'composition sync reveals once');
assert(
  applySurfaceReveal(afterReveal).isSurfaceRevealed === true,
  'reveal is idempotent (happens once)',
);
assert(
  applyFirstFrameAccepted(afterReveal).hasFirstFrame === true &&
    applyFirstFrameAccepted(afterReveal).isSurfaceRevealed === true,
  'duplicate first-frame after reveal does not reset cover',
);

assert(
  shouldShowStartupCoverWhileBuffering({
    hasFirstFrame: true,
    isSurfaceRevealed: true,
    isBuffering: true,
    hasError: false,
  }) === false,
  'buffering never re-shows startup cover after reveal',
);
assert(
  shouldShowStartupCoverWhileBuffering({
    hasFirstFrame: true,
    isSurfaceRevealed: false,
    isBuffering: true,
    hasError: false,
  }) === false,
  'buffering after first-frame acceptance does not re-cover (cover already up)',
);
assert(
  shouldShowStartupCoverWhileBuffering({
    hasFirstFrame: false,
    isSurfaceRevealed: false,
    isBuffering: true,
    hasError: false,
  }) === true,
  'pre-first-frame buffering keeps cover',
);

assert(
  resetFirstFrameForNewSource().hasFirstFrame === false &&
    resetFirstFrameForNewSource().isSurfaceRevealed === false,
  'source switch resets first-frame and reveal',
);

assert(
  canAcceptFirstFrameEvent({
    mounted: true,
    loadArmed: true,
    armedGeneration: 2,
    currentGeneration: 2,
    activeMediaId: 'm1',
  }) === true,
  'armed current generation accepts first frame',
);
assert(
  canAcceptFirstFrameEvent({
    mounted: true,
    loadArmed: true,
    armedGeneration: 1,
    currentGeneration: 2,
    activeMediaId: 'm1',
  }) === false,
  'stale generation first-frame ignored',
);
assert(
  canAcceptFirstFrameEvent({
    mounted: true,
    loadArmed: false,
    armedGeneration: 2,
    currentGeneration: 2,
    activeMediaId: 'm1',
  }) === false,
  'unarmed load rejects first frame',
);
assert(
  canAcceptFirstFrameEvent({
    mounted: false,
    loadArmed: true,
    armedGeneration: 2,
    currentGeneration: 2,
    activeMediaId: 'm1',
  }) === false,
  'unmounted session rejects first frame',
);

let scheduled = 0;
let revealed = 0;
let cancelled = false;
const handle = scheduleCompositionSyncedReveal({
  scheduleFrame: (cb) => {
    scheduled += 1;
    let alive = true;
    queueMicrotask(() => {
      if (alive) {
        cb();
      }
    });
    return {
      cancel: () => {
        alive = false;
        cancelled = true;
      },
    };
  },
  isStillValid: () => true,
  onReveal: () => {
    revealed += 1;
  },
});
assert(scheduled === 1, 'composition sync schedules exactly one frame callback');
handle.cancel();
assert(cancelled === true, 'pending composition sync can be cancelled');

assert(
  shouldAssignPlaybackSource({
    nextUri: 'file:///a.mp4',
    lastAssignedUri: null,
    generation: 1,
    lastAssignedGeneration: null,
  }) === true,
  'first URI assignment allowed',
);
assert(
  shouldAssignPlaybackSource({
    nextUri: 'file:///a.mp4',
    lastAssignedUri: 'file:///a.mp4',
    generation: 1,
    lastAssignedGeneration: 1,
  }) === false,
  'identical URI+generation does not reassign',
);
assert(
  shouldAssignPlaybackSource({
    nextUri: 'file:///a.mp4',
    lastAssignedUri: 'file:///a.mp4',
    generation: 2,
    lastAssignedGeneration: 1,
  }) === true,
  'retry/new generation may reassign same URI',
);
assert(
  shouldAssignPlaybackSource({
    nextUri: 'file:///b.mp4',
    lastAssignedUri: 'file:///a.mp4',
    generation: 2,
    lastAssignedGeneration: 1,
  }) === true,
  'previous/next source change assigns intentionally',
);

assert(
  isCurrentPlayerSession({
    mounted: true,
    loadArmed: true,
    capturedGeneration: 3,
    currentGeneration: 3,
    activeMediaId: 'x',
  }) === true,
  'session generation guard still valid',
);

// ─── Source / wiring invariants (static) ────────────────────────────────────

const sessionSrc = read('src/player/use-player-session.ts');
const surfaceSrc = read('src/screens/player/components/PlayerVideoSurface.tsx');
const screenSrc = read('src/screens/player/PlayerScreen.tsx');
const firstFrameSrc = read('src/player/first-frame-state.ts');
const layoutSrc = read('src/app/(app)/_layout.tsx');
const typesSrc = read('src/player/types.ts');

assert(
  surfaceSrc.includes('onFirstFrameRender'),
  'VideoView wires onFirstFrameRender',
);
assert(
  screenSrc.includes('onFirstFrameRender={markFirstFrameRendered}'),
  'PlayerScreen marks first frame from native callback',
);
assert(
  screenSrc.includes('shouldShowStartupCover'),
  'PlayerScreen uses startup cover helper',
);
assert(
  screenSrc.includes('isSurfaceRevealed'),
  'cover gated on composition-synced isSurfaceRevealed',
);
assert(
  screenSrc.includes('startupCover'),
  'startup cover layer present',
);
assert(
  !screenSrc.includes('FadeOut.duration'),
  'startup cover does not use FadeOut (instant reveal preferred)',
);
assert(
  !screenSrc.includes("from 'react-native-reanimated'"),
  'PlayerScreen no longer animates cover/control reveal via Reanimated fade',
);
assert(
  screenSrc.includes('theme.colors.black'),
  'player chrome uses theme black token',
);
assert(
  layoutSrc.includes('theme.colors.black') &&
    screenSrc.includes('playerSurfaceBg'),
  'navigation route background and player stage both use theme black',
);
assert(
  !screenSrc.includes('key={mediaId}'),
  'controls/fullscreen do not remount player via mediaId key',
);
assert(
  !screenSrc.includes('key={`${'),
  'no composite key remount on player surface',
);
assert(
  screenSrc.includes('<PlayerVideoSurface'),
  'PlayerVideoSurface always composed in body (stable mount)',
);
assert(
  !/showResolving\s*\?\s*\(/.test(screenSrc),
  'resolving no longer unmounts VideoView via ternary swap',
);
assert(
  (screenSrc.match(/<PlayerTopBar/g) || []).length === 1,
  'single TopBar instance (no cover/controls remount swap)',
);

assert(
  sessionSrc.includes('markFirstFrameRendered'),
  'session exposes markFirstFrameRendered',
);
assert(
  sessionSrc.includes('scheduleCompositionSyncedReveal'),
  'session defers reveal to next UI composition frame',
);
assert(
  sessionSrc.includes('createRequestAnimationFrameScheduler'),
  'reveal uses requestAnimationFrame scheduler (composition sync)',
);
assert(
  sessionSrc.includes('canAcceptFirstFrameEvent'),
  'session gates first frame with generation safety',
);
assert(
  sessionSrc.includes('shouldAssignPlaybackSource'),
  'session guards redundant source assignment',
);
assert(
  sessionSrc.includes('hasFirstFrame: false'),
  'load cycle resets hasFirstFrame',
);
assert(
  sessionSrc.includes('isSurfaceRevealed: false'),
  'load cycle resets isSurfaceRevealed',
);
assert(
  sessionSrc.includes("playerLog('player.first_frame'"),
  'first frame is diagnostic-logged',
);
assert(
  sessionSrc.includes("playerLog('player.surface_revealed'"),
  'surface reveal is diagnostic-logged once',
);
assert(
  sessionSrc.includes('prev.hasFirstFrame ? false : true'),
  'readyToPlay does not clear loading before first frame',
);
assert(
  sessionSrc.includes('cancelPendingReveal'),
  'pending composition sync cancelled on cleanup/generation change',
);
assert(
  /controller\.dispose\(/.test(sessionSrc),
  'player cleanup disposes controller on unmount',
);
assert(
  sessionSrc.includes('useEventListener(player'),
  'native listeners attached via useEventListener',
);
assert(
  !sessionSrc.includes('setTimeout(') ||
    !sessionSrc.includes('hidePoster') && !sessionSrc.includes('hideCover'),
  'session has no cover hide setTimeout',
);

assert(
  typesSrc.includes('hasFirstFrame: boolean'),
  'session state includes hasFirstFrame',
);
assert(
  typesSrc.includes('isSurfaceRevealed: boolean'),
  'session state includes isSurfaceRevealed',
);

assert(
  layoutSrc.includes('appStackRouteNames.player') ||
    layoutSrc.includes('player/[id]'),
  'player route registered in stack',
);

assert(
  !firstFrameSrc.includes('setTimeout'),
  'first-frame helpers have no arbitrary timers',
);
assert(
  !firstFrameSrc.includes('setInterval'),
  'first-frame helpers have no polling',
);
assert(
  firstFrameSrc.includes('requestAnimationFrame'),
  'rAF documented as composition sync scheduler',
);
assert(
  firstFrameSrc.includes('render synchronization') ||
    firstFrameSrc.includes('composition'),
  'rAF justified as composition/render sync not timing hack',
);
assert(
  !screenSrc.includes('setTimeout(() =>') ||
    screenSrc.includes('SEEK_FEEDBACK_MS'),
  'no arbitrary startup hide timer (seek feedback timer only)',
);
assert(
  !screenSrc.includes('setInterval'),
  'PlayerScreen has no polling',
);
assert(
  (screenSrc.match(/<PlayerVideoSurface/g) || []).length === 1,
  'no second hidden player / duplicate VideoSurface',
);
assert(
  !surfaceSrc.includes('surfaceType='),
  'does not blindly force TextureView surface type',
);
assert(
  screenSrc.includes('session.isLoading && session.hasFirstFrame'),
  'post-first-frame buffering spinner does not imply cover',
);

console.log(
  `\nPlayer first-frame stability: ${passed} passed, ${failed} failed`,
);
process.exit(failed > 0 ? 1 : 0);
