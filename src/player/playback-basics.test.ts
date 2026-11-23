/**
 * P1 Playback basics: seek interval (#527), frame stepping (#531), jump to time (#532), long-press speed (#545) and
 * the page's speed chip label.
 */

import assert from 'node:assert/strict';
import { describe, it } from 'node:test';

import {
  FALLBACK_FRAME_RATE,
  FRAME_STEP_CHAIN_MS,
  formatFrameTime,
  frameAt,
  frameDurationSeconds,
  frameStep,
  frameStepBase,
} from './frame-step.ts';
import { formatJumpTime, parseJumpTime } from './jump-to-time.ts';
import { LONG_PRESS_PLAYBACK_RATE, LongPressSpeed } from './long-press-speed.ts';
import { formatPlaybackRateChip } from './playback-rates.ts';
import { DEFAULT_SEEK_STEP_SECONDS, SEEK_STEP_OPTIONS, isSeekStepSeconds, normalizeSeekStepSeconds } from './seek-step.ts';

describe('seek interval (#527)', () => {
  it('offers 5 to 60 seconds and defaults to the old fixed 10 s', () => {
    assert.deepEqual([...SEEK_STEP_OPTIONS], [5, 10, 15, 20, 30, 60]);
    assert.equal(DEFAULT_SEEK_STEP_SECONDS, 10);
  });

  it('reads anything that is not an option as the default', () => {
    for (const option of SEEK_STEP_OPTIONS) {
      assert.equal(isSeekStepSeconds(option), true);
      assert.equal(normalizeSeekStepSeconds(option), option);
    }
    for (const bad of [undefined, null, 0, 7, -10, 10.5, Number.NaN, '10', {}]) {
      assert.equal(isSeekStepSeconds(bad), false, String(bad));
      assert.equal(normalizeSeekStepSeconds(bad), 10, String(bad));
    }
  });
});

describe('frame by frame (#531)', () => {
  it('steps one frame of the track, 30 fps when the rate is unknown or absurd', () => {
    assert.equal(frameDurationSeconds(25), 0.04);
    assert.equal(frameDurationSeconds(60), 1 / 60);
    assert.equal(FALLBACK_FRAME_RATE, 30);
    for (const bad of [null, undefined, 0, 0.5, -24, 1000, Number.NaN, Number.POSITIVE_INFINITY]) {
      assert.equal(frameDurationSeconds(bad), 1 / 30, String(bad));
    }
  });

  it('steps to the neighbouring frame and seeks into its middle', () => {
    // 10 s at 25 fps is the start of frame 250.
    assert.deepEqual(frameStep(10, 1, 25, 60), { seekSeconds: 10.06, frameStartSeconds: 10.04, frameIndex: 251 });
    assert.deepEqual(frameStep(10, -1, 25, 60), { seekSeconds: 9.98, frameStartSeconds: 9.96, frameIndex: 249 });
    // From the middle of a frame (where a step lands), the next step back is the frame before, not the same one.
    assert.equal(frameStep(10.06, -1, 25, 60)!.frameIndex, 250);
    assert.equal(frameStep(10.06, 1, 25, 60)!.frameIndex, 252);
  });

  it('goes from between two frames to the neighbouring frame', () => {
    // 10.018 s at 30 fps is inside frame 300 (10.000–10.033).
    assert.equal(frameStep(10.018, 1, 30, 60)!.frameIndex, 301);
    assert.equal(frameStep(10.018, -1, 30, 60)!.frameIndex, 299);
  });

  it('stops at the first frame and at the last one', () => {
    assert.deepEqual(frameStep(0.01, -1, 25, 60), { seekSeconds: 0.02, frameStartSeconds: 0, frameIndex: 0 });
    // 60 s at 25 fps has frames 0–1499; the last one never seeks past the end.
    assert.equal(frameStep(59.99, 1, 25, 60)!.frameIndex, 1499);
    assert.equal(frameStep(59.99, 1, 25, 60)!.seekSeconds, 59.98);
    assert.equal(frameStep(59.99, 1, 25, 59.99)!.seekSeconds <= 59.99, true);
    // Unknown length: forward is not capped.
    assert.equal(frameStep(5, 1, 25, null)!.frameIndex, 126);
    assert.equal(frameStep(Number.NaN, 1, 25, 60), null);
    assert.equal(frameStep(-1, 1, 25, 60), null);
  });

  it('does not drift over many steps', () => {
    let time = 0;
    for (let i = 0; i < 300; i += 1) {
      time = frameStep(time, 1, 30, 100)!.seekSeconds;
    }
    assert.equal(frameStep(time, 1, 30, 100)!.frameIndex, 301);
    for (let i = 0; i < 300; i += 1) {
      time = frameStep(time, -1, 30, 100)!.seekSeconds;
    }
    assert.equal(frameStep(time, 1, 30, 100)!.frameIndex, 1);
  });

  it('continues from the last target while taps keep coming, then from the player again', () => {
    const last = { target: 12.5, at: 1000 };
    assert.equal(frameStepBase(12.3, last, 1000 + FRAME_STEP_CHAIN_MS - 1), 12.5);
    assert.equal(frameStepBase(12.3, last, 1000 + FRAME_STEP_CHAIN_MS), 12.3);
    assert.equal(frameStepBase(12.3, null, 1000), 12.3);
    // A clock that went backwards does not chain.
    assert.equal(frameStepBase(12.3, last, 900), 12.3);
  });

  it('names the frame on screen when the panel opens', () => {
    assert.deepEqual(frameAt(10.018, 30), { frameIndex: 300, frameStartSeconds: 10 });
    assert.deepEqual(frameAt(0, 25), { frameIndex: 0, frameStartSeconds: 0 });
    // A frame start that is not exact in floating point still names that frame.
    assert.deepEqual(frameAt(301 / 30, 30), { frameIndex: 301, frameStartSeconds: 10.033333 });
    assert.equal(frameAt(Number.NaN, 30), null);
    assert.equal(frameAt(-0.5, 30), null);
  });

  it('shows the time with milliseconds', () => {
    assert.equal(formatFrameTime(84.033), '01:24.033');
    assert.equal(formatFrameTime(0), '00:00.000');
    assert.equal(formatFrameTime(3723.5), '1:02:03.500');
    assert.equal(formatFrameTime(59.9996), '01:00.000');
    assert.equal(formatFrameTime(null), '--:--.---');
    assert.equal(formatFrameTime(-1), '--:--.---');
  });
});

describe('jump to time (#532)', () => {
  it('reads seconds, m:ss and h:mm:ss', () => {
    assert.deepEqual(parseJumpTime('90'), { ok: true, seconds: 90 });
    assert.deepEqual(parseJumpTime('1:24'), { ok: true, seconds: 84 });
    assert.deepEqual(parseJumpTime('01:24'), { ok: true, seconds: 84 });
    assert.deepEqual(parseJumpTime('1:02:03'), { ok: true, seconds: 3723 });
    assert.deepEqual(parseJumpTime(' 2 : 05 '), { ok: true, seconds: 125 });
    assert.deepEqual(parseJumpTime('0'), { ok: true, seconds: 0 });
  });

  it('reads Urdu and Arabic digits and colon look-alikes', () => {
    const urdu = (text: string) => text.replace(/\d/g, (d) => String.fromCharCode(0x06f0 + Number(d)));
    const arabic = (text: string) => text.replace(/\d/g, (d) => String.fromCharCode(0x0660 + Number(d)));
    assert.deepEqual(parseJumpTime(urdu('1:24')), { ok: true, seconds: 84 });
    assert.deepEqual(parseJumpTime(arabic('1:02:03')), { ok: true, seconds: 3723 });
    assert.deepEqual(parseJumpTime(`1${String.fromCharCode(0xff1a)}24`), { ok: true, seconds: 84 });
    assert.deepEqual(parseJumpTime(`1${String.fromCharCode(0xa789)}24`), { ok: true, seconds: 84 });
  });

  it('refuses empty, malformed and clock-impossible times', () => {
    assert.deepEqual(parseJumpTime(''), { ok: false, reason: 'empty' });
    assert.deepEqual(parseJumpTime('   '), { ok: false, reason: 'empty' });
    for (const bad of ['1:60', '1:2:3:4', 'a', '1:-2', '1.5', ':30', '1:', '1:234', '1:00:75', '-5']) {
      assert.deepEqual(parseJumpTime(bad), { ok: false, reason: 'invalid' }, bad);
    }
  });

  it('refuses a time past the end of the video, and allows the end itself', () => {
    assert.deepEqual(parseJumpTime('5:00', 240), { ok: false, reason: 'beyond' });
    assert.deepEqual(parseJumpTime('4:00', 240), { ok: true, seconds: 240 });
    // Unknown length (a live stream): anything well-formed is allowed.
    assert.deepEqual(parseJumpTime('5:00', null), { ok: true, seconds: 300 });
    assert.deepEqual(parseJumpTime('5:00', 0), { ok: true, seconds: 300 });
  });

  it('starts the field at the current time', () => {
    assert.equal(formatJumpTime(84.9), '1:24');
    assert.equal(formatJumpTime(3723), '1:02:03');
    assert.equal(formatJumpTime(5), '0:05');
    assert.equal(formatJumpTime(null), '');
    assert.deepEqual(parseJumpTime(formatJumpTime(3723)), { ok: true, seconds: 3723 });
  });
});

describe('long press to fast forward (#545)', () => {
  function harness(chosen = 1.25) {
    const rates: number[] = [];
    const changes: boolean[] = [];
    let chosenRate = chosen;
    const speed = new LongPressSpeed({
      applyRate: (rate) => rates.push(rate),
      chosenRate: () => chosenRate,
      onChange: (active) => changes.push(active),
    });
    return { speed, rates, changes, setChosen: (rate: number) => (chosenRate = rate) };
  }

  it('plays at 2× while held and puts the chosen speed back', () => {
    const { speed, rates, changes } = harness(1.25);
    assert.equal(speed.start(true), true);
    assert.equal(speed.isActive, true);
    speed.end();
    assert.deepEqual(rates, [LONG_PRESS_PLAYBACK_RATE, 1.25]);
    assert.deepEqual(changes, [true, false]);
    assert.equal(LONG_PRESS_PLAYBACK_RATE, 2);
  });

  it('does nothing while paused, and a second start is ignored', () => {
    const { speed, rates } = harness();
    assert.equal(speed.start(false), false);
    assert.deepEqual(rates, []);
    speed.start(true);
    assert.equal(speed.start(true), false);
    assert.deepEqual(rates, [2]);
  });

  it('lets every exit path call end(): only the first restores', () => {
    const { speed, rates, setChosen } = harness(1);
    speed.end();
    assert.deepEqual(rates, []);
    speed.start(true);
    setChosen(0.75);
    speed.end();
    speed.end();
    assert.deepEqual(rates, [2, 0.75]);
    assert.equal(speed.isActive, false);
  });
});

describe('speed chip label (screen 19)', () => {
  it('always shows one decimal at least', () => {
    assert.equal(formatPlaybackRateChip(1), '1.0×');
    assert.equal(formatPlaybackRateChip(2), '2.0×');
    assert.equal(formatPlaybackRateChip(1.5), '1.5×');
    assert.equal(formatPlaybackRateChip(0.75), '0.75×');
    assert.equal(formatPlaybackRateChip(1.25), '1.25×');
    assert.equal(formatPlaybackRateChip(Number.NaN), '1.0×');
  });
});
