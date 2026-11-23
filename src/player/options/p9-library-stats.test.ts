/**
 * P9's rows in the options sheet: "Don't save watch history" last under Playback (200), "Add bookmark" (40) and
 * "Bookmarks" (45) under Tools after P7's Add to playlist, and "Delete video" (90) after P8's Customize controls.
 */

import assert from 'node:assert/strict';
import { describe, it } from 'node:test';

import { libraryStatsEn } from '../../localization/catalogs/libraryStats.en.ts';
import { libraryStatsUr } from '../../localization/catalogs/libraryStats.ur.ts';

import './p1-playback-basics.ts';
import './p7-playlists.ts';
import './p8-gestures.ts';
import { P9_OWNER, P9_PLAYER_OPTIONS } from './p9-library-stats.ts';
import { playerOptions, type PlayerOptionContext, type PlayerOptionUi } from './player-options.ts';

const ui = new Proxy({} as PlayerOptionUi, { get: () => () => undefined });

type P9Context = NonNullable<PlayerOptionContext['p9']>;

const calls: string[] = [];
const p9 = (patch: Partial<P9Context> = {}): P9Context => ({
  historyPaused: false,
  setHistoryPaused: (paused) => calls.push(`history:${paused}`),
  bookmarks: { available: true, count: 0, add: () => calls.push('add'), openList: () => calls.push('list') },
  quickDelete: { available: true, run: () => calls.push('delete') },
  ...patch,
});

const context = (extra: P9Context | 'none', ready = true) =>
  ({
    t: ((key: string) => key) as PlayerOptionContext['t'],
    mediaId: 'm1',
    player: {} as PlayerOptionContext['player'],
    controller: {} as PlayerOptionContext['controller'],
    session: { isReady: ready, isPlaying: true, hasError: false, positionSeconds: 12, durationSeconds: 60, playbackRate: 1 },
    seekStepSeconds: 10,
    orientationMode: 'auto',
    incoming: null,
    display: { fit: 'fit', mirror: 'none', fillCutout: false, infoOverlay: false },
    subtitles: { label: null, isFile: false, offsetMs: 0, encodingLabel: null, autoDetect: true, secondLabel: null },
    playlists: { canAdd: true, openAddSheet: () => undefined },
    gestures: { enabled: true, sensitivity: 'normal', onCount: 5, total: 7 },
    p9: extra === 'none' ? undefined : extra,
    ui,
  }) as PlayerOptionContext;

const rowsOf = (ctx: PlayerOptionContext, section: string) =>
  playerOptions.sections(ctx).find((view) => view.section === section)?.rows ?? [];
const idsOf = (ctx: PlayerOptionContext, section: string) => rowsOf(ctx, section).map((entry) => entry.row.id);

describe('P9 rows in the options sheet', () => {
  it('registers four rows at their orders', () => {
    assert.deepEqual(
      playerOptions.all().filter((entry) => entry.owner === P9_OWNER).map((entry) => [entry.row.id, entry.row.section, entry.row.order]),
      [
        ['p9.disableHistory', 'playback', 200],
        ['p9.addBookmark', 'tools', 40],
        ['p9.bookmarks', 'tools', 45],
        ['p9.quickDelete', 'tools', 90],
      ],
    );
  });

  it('places them: history last under Playback; bookmarks after Add to playlist, Delete video after Customize controls', () => {
    const ctx = context(p9());
    const playback = idsOf(ctx, 'playback');
    assert.equal(playback[playback.length - 1], 'p9.disableHistory');
    assert.deepEqual(idsOf(ctx, 'tools'), [
      'p7.addToPlaylist',
      'p9.addBookmark',
      'p9.bookmarks',
      'p8.customizeControls',
      'p9.quickDelete',
    ]);
  });

  it('Disable History is a switch showing the setting, and flips it', () => {
    calls.length = 0;
    const off = rowsOf(context(p9()), 'playback').find((entry) => entry.row.id === 'p9.disableHistory')!;
    assert.equal(off.toggle, false);
    off.row.onPress(context(p9()));
    const on = rowsOf(context(p9({ historyPaused: true })), 'playback').find((entry) => entry.row.id === 'p9.disableHistory')!;
    assert.equal(on.toggle, true);
    on.row.onPress(context(p9({ historyPaused: true })));
    assert.deepEqual(calls, ['history:true', 'history:false']);
  });

  it('bookmarks: the count as the value, Add needs a ready video, and both act', () => {
    calls.length = 0;
    const tools = rowsOf(context(p9({ bookmarks: { ...p9().bookmarks, count: 3 } })), 'tools');
    const list = tools.find((entry) => entry.row.id === 'p9.bookmarks')!;
    assert.equal(list.value, '3');
    assert.equal(rowsOf(context(p9()), 'tools').find((entry) => entry.row.id === 'p9.bookmarks')!.value, null);
    const add = tools.find((entry) => entry.row.id === 'p9.addBookmark')!;
    assert.equal(add.enabled, true);
    assert.equal(
      rowsOf(context(p9(), false), 'tools').find((entry) => entry.row.id === 'p9.addBookmark')!.enabled,
      false,
    );
    for (const id of ['p9.addBookmark', 'p9.bookmarks', 'p9.quickDelete']) {
      P9_PLAYER_OPTIONS.find((row) => row.id === id)!.onPress(context(p9()));
    }
    assert.deepEqual(calls, ['add', 'list', 'delete']);
  });

  it('hidden where they don’t apply: no P9 state, no lasting id (bookmarks), not a library video (delete)', () => {
    assert.ok(!idsOf(context('none'), 'tools').some((id) => id.startsWith('p9.')));
    assert.ok(!idsOf(context('none'), 'playback').includes('p9.disableHistory'));
    const noMarks = context(p9({ bookmarks: { ...p9().bookmarks, available: false } }));
    assert.deepEqual(idsOf(noMarks, 'tools').filter((id) => id.startsWith('p9.')), ['p9.quickDelete']);
    const noDelete = context(p9({ quickDelete: { available: false, run: () => undefined } }));
    assert.ok(!idsOf(noDelete, 'tools').includes('p9.quickDelete'));
    assert.ok(idsOf(noDelete, 'playback').includes('p9.disableHistory'), 'Disable History is app-wide');
  });

  it('every libraryStats string is in Urdu, translated, with the same placeholders', () => {
    const placeholders = (text: string) => (text.match(/\{\w+\}/g) ?? []).sort();
    const english = libraryStatsEn as Record<string, string>;
    const urdu = libraryStatsUr as Record<string, string>;
    assert.deepEqual(Object.keys(urdu).sort(), Object.keys(english).sort());
    for (const [key, text] of Object.entries(english)) {
      assert.ok(urdu[key]?.trim(), `${key} is empty in Urdu`);
      assert.notEqual(urdu[key], text, `${key} is not translated`);
      assert.deepEqual(placeholders(urdu[key]!), placeholders(text), key);
    }
    for (const row of P9_PLAYER_OPTIONS) {
      assert.ok(row.label.replace('libraryStats.', '') in english, row.label);
      if (row.subtitle) assert.ok(row.subtitle.replace('libraryStats.', '') in english, row.subtitle);
    }
  });
});
