/**
 * P6's rows in the options sheet: Up next, Shuffle, Auto play next and the Next episode card, under Playback after
 * P5's rows.
 */

import assert from 'node:assert/strict';
import { describe, it } from 'node:test';

import './p1-playback-basics.ts';
import './p5-repeat.ts';
import { P6_OWNER, P6_PLAYER_OPTIONS } from './p6-queue.ts';
import { playerOptions, type PlayerOptionContext, type PlayerOptionUi } from './player-options.ts';

const calls: [string, unknown][] = [];
const ui = new Proxy({} as PlayerOptionUi, {
  get: (_target, name: string) => (value?: unknown) => calls.push([name, value]),
});

type QueueContext = NonNullable<PlayerOptionContext['queue']>;
const QUEUE: QueueContext = { countLabel: '3 videos', size: 3, shuffled: false, autoPlayNext: false, nextEpisodePrompt: true };

const context = (queue: QueueContext | 'none' = QUEUE) =>
  ({
    t: ((key: string) => key) as PlayerOptionContext['t'],
    mediaId: 'm1',
    player: {} as PlayerOptionContext['player'],
    controller: {} as PlayerOptionContext['controller'],
    session: { isReady: true, isPlaying: true, hasError: false, positionSeconds: 12, durationSeconds: 60, playbackRate: 1 },
    seekStepSeconds: 10,
    orientationMode: 'auto',
    incoming: null,
    display: { fit: 'fit', mirror: 'none', fillCutout: false, infoOverlay: false },
    subtitles: { label: null, isFile: false, offsetMs: 0, encodingLabel: null, autoDetect: true, secondLabel: null },
    repeat: { endActionLabel: 'Stop', abLabel: 'Off' },
    queue: queue === 'none' ? undefined : queue,
    ui,
  }) as PlayerOptionContext;

const playbackRows = (ctx: PlayerOptionContext) =>
  playerOptions.sections(ctx).find((section) => section.section === 'playback')?.rows ?? [];

describe('P6 rows in the options sheet', () => {
  it('puts Up next, Shuffle, Auto play next and the Next episode card after P5’s rows', () => {
    const ids = playbackRows(context()).map((entry) => entry.row.id);
    const at = ids.indexOf('p5.abRepeat');
    assert.deepEqual(ids.slice(at, at + 5), [
      'p5.abRepeat',
      'p6.queue',
      'p6.shuffle',
      'p6.autoPlayNext',
      'p6.nextEpisodePrompt',
    ]);
    assert.deepEqual(
      playerOptions.all().filter((entry) => entry.owner === P6_OWNER).map((entry) => entry.row.id),
      ['p6.queue', 'p6.shuffle', 'p6.autoPlayNext', 'p6.nextEpisodePrompt'],
    );
  });

  it('shows the queue size and the switches, and flips them', () => {
    const rows = playbackRows(context({ ...QUEUE, autoPlayNext: true }));
    assert.equal(rows.find((entry) => entry.row.id === 'p6.queue')?.value, '3 videos');
    calls.length = 0;
    for (const option of P6_PLAYER_OPTIONS) {
      option.onPress(context({ ...QUEUE, autoPlayNext: true }));
    }
    assert.deepEqual(calls, [
      ['openQueue', undefined],
      ['setShuffle', true],
      ['setAutoPlayNext', false],
      ['setNextEpisodePrompt', false],
    ]);
  });

  it('Shuffle needs two videos; nothing shows where the screen gives no queue state', () => {
    const shuffle = playbackRows(context({ ...QUEUE, size: 1 })).find((entry) => entry.row.id === 'p6.shuffle');
    assert.equal(shuffle?.enabled, false);
    const ids = playbackRows(context('none')).map((entry) => entry.row.id);
    assert.ok(ids.every((id) => !id.startsWith('p6.')));
  });
});
