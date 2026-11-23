/**
 * P11's row in the options sheet: "Move to Private" under Tools at 85 — after P8's Customize controls (80), before
 * P9's Delete video (90) — for library videos only.
 */

import assert from 'node:assert/strict';
import { describe, it } from 'node:test';

import { en } from '../../localization/en.ts';
import { privacyBackupEn } from '../../localization/catalogs/privacyBackup.en.ts';
import { privacyBackupUr } from '../../localization/catalogs/privacyBackup.ur.ts';
import { ur } from '../../localization/ur.ts';

import './p1-playback-basics.ts';
import './p7-playlists.ts';
import './p8-gestures.ts';
import './p9-library-stats.ts';
import { P11_OWNER, P11_PLAYER_OPTIONS } from './p11-privacy.ts';
import { playerOptions, type PlayerOptionContext, type PlayerOptionUi } from './player-options.ts';

const ui = new Proxy({} as PlayerOptionUi, { get: () => () => undefined });

type Privacy = NonNullable<PlayerOptionContext['privacy']>;

const pressed: string[] = [];
const privacy = (available: boolean): Privacy => ({
  moveToPrivate: { available, run: () => pressed.push('move') },
});

const context = (extra: Privacy | undefined) =>
  ({
    t: ((key: string) => key) as PlayerOptionContext['t'],
    mediaId: 'lib1',
    player: {} as PlayerOptionContext['player'],
    controller: {} as PlayerOptionContext['controller'],
    session: { isReady: true, isPlaying: true, hasError: false, positionSeconds: 12, durationSeconds: 60, playbackRate: 1 },
    seekStepSeconds: 10,
    orientationMode: 'auto',
    incoming: null,
    display: { fit: 'fit', mirror: 'none', fillCutout: false, infoOverlay: false },
    subtitles: { label: null, isFile: false, offsetMs: 0, encodingLabel: null, autoDetect: true, secondLabel: null },
    gestures: { enabled: true, sensitivity: 'normal', onCount: 5, total: 7 },
    playlists: { canAdd: true, openAddSheet: () => undefined },
    p9: {
      historyPaused: false,
      setHistoryPaused: () => undefined,
      bookmarks: { available: true, count: 0, add: () => undefined, openList: () => undefined },
      quickDelete: { available: true, run: () => undefined },
    },
    privacy: extra,
    ui,
  }) as PlayerOptionContext;

const toolIds = (ctx: PlayerOptionContext) =>
  (playerOptions.sections(ctx).find((section) => section.section === 'tools')?.rows ?? []).map((entry) => entry.row.id);

describe('P11 row in the options sheet', () => {
  it('registers Move to Private under Tools at 85', () => {
    assert.deepEqual(
      playerOptions
        .all()
        .filter((entry) => entry.owner === P11_OWNER)
        .map((entry) => [entry.row.id, entry.row.section, entry.row.order, entry.row.icon]),
      [['p11.moveToPrivate', 'tools', 85, 'lock']],
    );
  });

  it('sits after Customize controls and before Delete video', () => {
    const ids = toolIds(context(privacy(true)));
    const at = ids.indexOf('p11.moveToPrivate');
    assert.ok(at > ids.indexOf('p8.customizeControls'), ids.join());
    assert.equal(ids[at + 1], 'p9.quickDelete');
  });

  it('hidden unless the screen says the video can move (device videos, other apps’ files, streams: no)', () => {
    assert.ok(!toolIds(context(privacy(false))).includes('p11.moveToPrivate'));
    assert.ok(!toolIds(context(undefined)).includes('p11.moveToPrivate'));
  });

  it('opens Private’s own move dialog', () => {
    pressed.length = 0;
    P11_PLAYER_OPTIONS[0]!.onPress(context(privacy(true)));
    assert.deepEqual(pressed, ['move']);
  });

  it('its label and hint are Private’s own strings, in English and Urdu', () => {
    const row = P11_PLAYER_OPTIONS[0]!;
    assert.equal(row.label, 'privateVault.moveAction');
    assert.equal(row.subtitle, 'privateVault.moveHint');
    assert.ok(en.privateVault.moveAction && ur.privateVault.moveAction);
    assert.notEqual(ur.privateVault.moveHint, en.privateVault.moveHint);
  });

  it('every privacyBackup string is in Urdu, translated, with the same placeholders', () => {
    const placeholders = (text: string) => (text.match(/\{\w+\}/g) ?? []).sort();
    const english = privacyBackupEn as Record<string, string>;
    const urdu = privacyBackupUr as Record<string, string>;
    assert.deepEqual(Object.keys(urdu).sort(), Object.keys(english).sort());
    for (const [key, text] of Object.entries(english)) {
      assert.ok(urdu[key]?.trim(), `${key} is empty in Urdu`);
      assert.notEqual(urdu[key], text, `${key} is not translated`);
      assert.deepEqual(placeholders(urdu[key]!), placeholders(text), key);
    }
  });
});
