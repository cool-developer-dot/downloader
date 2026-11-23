/**
 * P10's rows in the options sheet: Screenshot, Trim video, Extract audio, Video converter and Compress video under
 * Tools (orders 50–70), shown only where the screen says the tool applies, with the running edit's progress.
 */

import assert from 'node:assert/strict';
import { describe, it } from 'node:test';

import { videoPlayerEn } from '../../localization/catalogs/videoPlayer.en.ts';
import { videoPlayerUr } from '../../localization/catalogs/videoPlayer.ur.ts';

import './p1-playback-basics.ts';
import './p7-playlists.ts';
import './p8-gestures.ts';
import { P10_OWNER, P10_PLAYER_OPTIONS } from './p10-edit-tools.ts';
import { playerOptions, type PlayerOptionContext, type PlayerOptionUi } from './player-options.ts';

const ui = new Proxy({} as PlayerOptionUi, { get: () => () => undefined });

const pressed: string[] = [];
type EditTools = NonNullable<PlayerOptionContext['editTools']>;

function tools(overrides: Partial<EditTools> = {}): EditTools {
  return {
    canScreenshot: true,
    canEdit: true,
    canCompress: true,
    running: null,
    screenshot: () => pressed.push('screenshot'),
    openTrim: () => pressed.push('trim'),
    extractAudio: () => pressed.push('audio'),
    openConverter: () => pressed.push('converter'),
    openCompress: () => pressed.push('compress'),
    ...overrides,
  };
}

const context = (editTools: EditTools | undefined, ready = true) =>
  ({
    t: ((key: string) => key) as PlayerOptionContext['t'],
    mediaId: 'lib1',
    player: {} as PlayerOptionContext['player'],
    controller: {} as PlayerOptionContext['controller'],
    session: { isReady: ready, isPlaying: true, hasError: false, positionSeconds: 12, durationSeconds: 60, playbackRate: 1 },
    seekStepSeconds: 10,
    orientationMode: 'auto',
    incoming: null,
    display: { fit: 'fit', mirror: 'none', fillCutout: false, infoOverlay: false },
    subtitles: { label: null, isFile: false, offsetMs: 0, encodingLabel: null, autoDetect: true, secondLabel: null },
    gestures: { enabled: true, sensitivity: 'normal', onCount: 5, total: 7 },
    playlists: { canAdd: true, openAddSheet: () => undefined },
    editTools,
    ui,
  }) as PlayerOptionContext;

const toolRows = (ctx: PlayerOptionContext) =>
  playerOptions.sections(ctx).find((section) => section.section === 'tools')?.rows ?? [];

const P10_IDS = ['p10.screenshot', 'p10.trim', 'p10.extractAudio', 'p10.converter', 'p10.compress'];

describe('P10 rows in the options sheet', () => {
  it('sit under Tools at 50–70, after Add to playlist and before Customize controls', () => {
    assert.deepEqual(
      playerOptions.all().filter((entry) => entry.owner === P10_OWNER).map((entry) => [entry.row.id, entry.row.section, entry.row.order]),
      [
        ['p10.screenshot', 'tools', 50],
        ['p10.trim', 'tools', 55],
        ['p10.extractAudio', 'tools', 60],
        ['p10.converter', 'tools', 65],
        ['p10.compress', 'tools', 70],
      ],
    );
    assert.deepEqual(
      toolRows(context(tools())).map((entry) => entry.row.id),
      ['p7.addToPlaylist', ...P10_IDS, 'p8.customizeControls'],
    );
  });

  it('each row calls its tool', () => {
    pressed.length = 0;
    const ctx = context(tools());
    for (const row of P10_PLAYER_OPTIONS) {
      row.onPress(ctx);
    }
    assert.deepEqual(pressed, ['screenshot', 'trim', 'audio', 'converter', 'compress']);
  });

  it('a device video or a file from another app gets Screenshot only; a stream gets none', () => {
    const ids = (ctx: PlayerOptionContext) => toolRows(ctx).map((entry) => entry.row.id).filter((id) => id.startsWith('p10.'));
    assert.deepEqual(ids(context(tools({ canEdit: false, canCompress: false }))), ['p10.screenshot']);
    assert.deepEqual(ids(context(tools({ canScreenshot: false, canEdit: false, canCompress: false }))), []);
    // A library video before its first frame shows (or a build without the frame export): the editors, no Screenshot.
    assert.deepEqual(ids(context(tools({ canScreenshot: false }))), P10_IDS.slice(1));
    // A build whose editor has no Compress.
    assert.deepEqual(ids(context(tools({ canCompress: false }))), P10_IDS.slice(0, 4));
    // A screen that gives no tools state.
    assert.deepEqual(ids(context(undefined)), []);
  });

  it('Screenshot and Trim wait for the video to be ready; a running edit shows its progress on the editor rows', () => {
    const rows = toolRows(context(tools({ running: '45%' }), false));
    const byId = new Map(rows.map((entry) => [entry.row.id, entry]));
    assert.equal(byId.get('p10.screenshot')?.enabled, false);
    assert.equal(byId.get('p10.trim')?.enabled, false);
    assert.equal(byId.get('p10.extractAudio')?.enabled, true);
    assert.deepEqual(
      P10_IDS.map((id) => byId.get(id)?.value),
      [null, '45%', '45%', '45%', '45%'],
    );
  });

  it('every row has a title and a hint in English and (translated) Urdu', () => {
    const english = videoPlayerEn as Record<string, string>;
    const urdu = videoPlayerUr as Record<string, string>;
    for (const row of P10_PLAYER_OPTIONS) {
      for (const key of [row.label, row.subtitle]) {
        const name = String(key).replace('videoPlayer.', '');
        assert.ok(english[name], `${name} in English`);
        assert.ok(urdu[name] && urdu[name] !== english[name], `${name} in Urdu`);
      }
    }
  });
});
