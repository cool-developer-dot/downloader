/**
 * P4's rows in the options sheet: Style and Second subtitle, under Subtitles between P3's rows (screen 21's order).
 */

import assert from 'node:assert/strict';
import { describe, it } from 'node:test';

import './p3-subtitles.ts';
import { P4_OWNER, P4_PLAYER_OPTIONS } from './p4-subtitle-style.ts';
import { playerOptions, type PlayerOptionContext, type PlayerOptionUi } from './player-options.ts';

const calls: string[] = [];
const ui = new Proxy({} as PlayerOptionUi, {
  get: (_target, name: string) => () => calls.push(name),
});

const context = (subtitles: Partial<PlayerOptionContext['subtitles']> = {}): PlayerOptionContext => ({
  t: ((key: string) => key) as PlayerOptionContext['t'],
  mediaId: 'm1',
  player: {} as PlayerOptionContext['player'],
  controller: {} as PlayerOptionContext['controller'],
  session: { isReady: true, isPlaying: true, hasError: false, positionSeconds: 12, durationSeconds: 60, playbackRate: 1 },
  seekStepSeconds: 10,
  orientationMode: 'auto',
  incoming: null,
  display: { fit: 'fit', mirror: 'none', fillCutout: false, infoOverlay: false },
  subtitles: { label: 'Urdu · a.ur.srt', isFile: true, offsetMs: 0, encodingLabel: 'UTF-8', autoDetect: true, secondLabel: null, ...subtitles },
  gestures: { enabled: true, sensitivity: 'normal', onCount: 7, total: 7 },
  ui,
});

describe('P4 rows in the options sheet', () => {
  it('puts Style and Second subtitle after Encoding and before Subtitle off', () => {
    const rows = playerOptions.sections(context()).find((section) => section.section === 'subtitles')?.rows ?? [];
    assert.deepEqual(
      rows.map((entry) => entry.row.id),
      ['p3.track', 'p3.load', 'p3.autoDetect', 'p3.sync', 'p3.encoding', 'p4.style', 'p4.second', 'p3.off'],
    );
    assert.deepEqual(
      playerOptions.all().filter((entry) => entry.owner === P4_OWNER).map((entry) => entry.row.id),
      ['p4.style', 'p4.second'],
    );
  });

  it('shows the second subtitle (or Off), and opens the style and second-subtitle sheets', () => {
    const value = (secondLabel: string | null) =>
      playerOptions
        .sections(context({ secondLabel }))
        .flatMap((section) => section.rows)
        .find((entry) => entry.row.id === 'p4.second')?.value;
    assert.equal(value(null), 'videoPlayer.subtitleOffValue');
    assert.equal(value('English · a.en.srt'), 'English · a.en.srt');
    calls.length = 0;
    for (const option of P4_PLAYER_OPTIONS) {
      option.onPress(context());
    }
    assert.deepEqual(calls, ['openSubtitleStyle', 'openSubtitleSecond']);
  });
});
