/**
 * P12's rows in the options sheet: Create GIF, Merge videos and Change speed under Tools (orders 72, 74, 76), shown
 * only where the screen says each applies, with the running edit's progress.
 */

import assert from 'node:assert/strict';
import { describe, it } from 'node:test';

import { videoPlayerEn } from '../../localization/catalogs/videoPlayer.en.ts';
import { videoPlayerUr } from '../../localization/catalogs/videoPlayer.ur.ts';

import './p1-playback-basics.ts';
import './p7-playlists.ts';
import './p8-gestures.ts';
import './p10-edit-tools.ts';
import { P12_OWNER, P12_PLAYER_OPTIONS } from './p12-export-extras.ts';
import { playerOptions, type PlayerOptionContext, type PlayerOptionUi } from './player-options.ts';

const ui = new Proxy({} as PlayerOptionUi, { get: () => () => undefined });

const pressed: string[] = [];
type ExportExtras = NonNullable<PlayerOptionContext['exportExtras']>;
type EditTools = NonNullable<PlayerOptionContext['editTools']>;

function extras(overrides: Partial<ExportExtras> = {}): ExportExtras {
  return {
    canGif: true,
    canMerge: true,
    canSpeed: true,
    running: null,
    openGif: () => pressed.push('gif'),
    openMerge: () => pressed.push('merge'),
    openSpeed: () => pressed.push('speed'),
    ...overrides,
  };
}

const editTools: EditTools = {
  canScreenshot: true,
  canEdit: true,
  canCompress: true,
  running: null,
  screenshot: () => undefined,
  openTrim: () => undefined,
  extractAudio: () => undefined,
  openConverter: () => undefined,
  openCompress: () => undefined,
};

const context = (exportExtras: ExportExtras | undefined, ready = true) =>
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
    exportExtras,
    ui,
  }) as PlayerOptionContext;

const toolRows = (ctx: PlayerOptionContext) =>
  playerOptions.sections(ctx).find((section) => section.section === 'tools')?.rows ?? [];

const P12_IDS = ['p12.createGif', 'p12.mergeVideos', 'p12.changeSpeed'];

describe('P12 rows in the options sheet', () => {
  it('sit under Tools at 72, 74 and 76: after P10’s editors, before Customize controls', () => {
    assert.deepEqual(
      playerOptions.all().filter((entry) => entry.owner === P12_OWNER).map((entry) => [entry.row.id, entry.row.section, entry.row.order]),
      [
        ['p12.createGif', 'tools', 72],
        ['p12.mergeVideos', 'tools', 74],
        ['p12.changeSpeed', 'tools', 76],
      ],
    );
    const ids = toolRows(context(extras())).map((entry) => entry.row.id);
    assert.deepEqual(ids.slice(ids.indexOf('p10.compress')), ['p10.compress', ...P12_IDS, 'p8.customizeControls']);
  });

  it('each row opens its tool', () => {
    pressed.length = 0;
    const ctx = context(extras());
    for (const row of P12_PLAYER_OPTIONS) {
      row.onPress(ctx);
    }
    assert.deepEqual(pressed, ['gif', 'merge', 'speed']);
  });

  it('each row only where it applies; none without the screen’s state', () => {
    const ids = (ctx: PlayerOptionContext) => toolRows(ctx).map((entry) => entry.row.id).filter((id) => id.startsWith('p12.'));
    assert.deepEqual(ids(context(extras({ canGif: false }))), P12_IDS.slice(1));
    assert.deepEqual(ids(context(extras({ canMerge: false, canSpeed: false }))), ['p12.createGif']);
    assert.deepEqual(ids(context(extras({ canGif: false, canMerge: false, canSpeed: false }))), []);
    assert.deepEqual(ids(context(undefined)), []);
  });

  it('Create GIF waits for the video to be ready; a running edit shows its progress on every row', () => {
    const rows = toolRows(context(extras({ running: '45%' }), false));
    const byId = new Map(rows.map((entry) => [entry.row.id, entry]));
    assert.equal(byId.get('p12.createGif')?.enabled, false);
    assert.equal(byId.get('p12.mergeVideos')?.enabled, true);
    assert.equal(byId.get('p12.changeSpeed')?.enabled, true);
    assert.deepEqual(
      P12_IDS.map((id) => byId.get(id)?.value),
      ['45%', '45%', '45%'],
    );
  });

  it('every row has a title and a hint in English and (translated) Urdu', () => {
    const english = videoPlayerEn as Record<string, string>;
    const urdu = videoPlayerUr as Record<string, string>;
    for (const row of P12_PLAYER_OPTIONS) {
      for (const key of [row.label, row.subtitle]) {
        const name = String(key).replace('videoPlayer.', '');
        assert.ok(english[name], `${name} in English`);
        assert.ok(urdu[name] && urdu[name] !== english[name], `${name} in Urdu`);
      }
    }
  });
});
