/**
 * P7's row in the options sheet: "Add to playlist" under Tools after P1's "Save to VidoraX", only where the screen
 * says the video can be in a playlist.
 */

import assert from 'node:assert/strict';
import { describe, it } from 'node:test';

import { playlistsEn } from '../../localization/catalogs/playlists.en.ts';
import { playlistsUr } from '../../localization/catalogs/playlists.ur.ts';

import './p1-playback-basics.ts';
import { P7_OWNER, P7_PLAYER_OPTIONS } from './p7-playlists.ts';
import { playerOptions, type PlayerOptionContext, type PlayerOptionUi } from './player-options.ts';

const ui = new Proxy({} as PlayerOptionUi, { get: () => () => undefined });

let opened = 0;
const context = (
  playlists: PlayerOptionContext['playlists'] | 'none',
  incoming: PlayerOptionContext['incoming'] = null,
) =>
  ({
    t: ((key: string) => key) as PlayerOptionContext['t'],
    mediaId: 'm1',
    player: {} as PlayerOptionContext['player'],
    controller: {} as PlayerOptionContext['controller'],
    session: { isReady: true, isPlaying: true, hasError: false, positionSeconds: 12, durationSeconds: 60, playbackRate: 1 },
    seekStepSeconds: 10,
    orientationMode: 'auto',
    incoming,
    display: { fit: 'fit', mirror: 'none', fillCutout: false, infoOverlay: false },
    subtitles: { label: null, isFile: false, offsetMs: 0, encodingLabel: null, autoDetect: true, secondLabel: null },
    playlists: playlists === 'none' ? undefined : playlists,
    ui,
  }) as PlayerOptionContext;

const toolRows = (ctx: PlayerOptionContext) =>
  playerOptions.sections(ctx).find((section) => section.section === 'tools')?.rows.map((entry) => entry.row.id) ?? [];

describe('P7 row in the options sheet', () => {
  it('puts Add to playlist under Tools, after P1’s Save to VidoraX, and opens the add sheet', () => {
    const ctx = context({ canAdd: true, openAddSheet: () => (opened += 1) }, { saveState: 'idle' });
    assert.deepEqual(toolRows(ctx), ['p1.saveToLibrary', 'p7.addToPlaylist']);
    assert.deepEqual(
      playerOptions.all().filter((entry) => entry.owner === P7_OWNER).map((entry) => [entry.row.section, entry.row.order]),
      [['tools', 30]],
    );
    opened = 0;
    P7_PLAYER_OPTIONS[0]!.onPress(ctx);
    assert.equal(opened, 1);
  });

  it('is hidden for a video that can’t be in a playlist, and where a screen gives no playlist state', () => {
    assert.deepEqual(toolRows(context({ canAdd: false, openAddSheet: () => undefined })), []);
    assert.deepEqual(toolRows(context('none')), []);
  });

  it('its strings (and every playlists string) are in Urdu, translated, with the same placeholders', () => {
    const placeholders = (text: string) => (text.match(/\{\w+\}/g) ?? []).sort();
    const english = playlistsEn as Record<string, string>;
    const urdu = playlistsUr as Record<string, string>;
    assert.deepEqual(Object.keys(urdu).sort(), Object.keys(english).sort());
    for (const [key, text] of Object.entries(english)) {
      assert.ok(urdu[key]?.trim(), `${key} is empty in Urdu`);
      assert.notEqual(urdu[key], text, `${key} is not translated`);
      assert.deepEqual(placeholders(urdu[key]!), placeholders(text), key);
    }
    assert.ok('addToPlaylist' in english);
  });
});
