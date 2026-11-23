/**
 * The Player's options sheet registry: five fixed sections, one register call per package, no package changing
 * another's rows; and where P1's rows sit.
 */

import assert from 'node:assert/strict';
import { describe, it } from 'node:test';

import { P1_OWNER, P1_PLAYER_OPTIONS } from './p1-playback-basics.ts';
import { playerOptions, type PlayerOptionContext, type PlayerOptionUi } from './player-options.ts';
import {
  PLAYER_OPTION_SECTIONS,
  PlayerOptionsRegistryError,
  createPlayerOptionsRegistry,
  type PlayerOptionRow,
} from './registry.ts';

type Ctx = { ready: boolean; incoming: boolean };
type Row = PlayerOptionRow<Ctx>;

const row = (id: string, section: Row['section'], order: number, extra: Partial<Row> = {}): Row => ({
  id,
  section,
  order,
  label: id,
  icon: 'circle',
  onPress: () => {},
  ...extra,
});

const ids = (registry: ReturnType<typeof createPlayerOptionsRegistry<Ctx>>, ctx: Ctx = { ready: true, incoming: false }) =>
  registry.sections(ctx).map((view) => [view.section, view.rows.map((entry) => entry.row.id)] as const);

describe('options sheet registry', () => {
  it('has the five sections in the plan order', () => {
    assert.deepEqual([...PLAYER_OPTION_SECTIONS], ['playback', 'video', 'audio', 'subtitles', 'tools']);
  });

  it('shows sections in the fixed order whatever the registration order, and leaves empty ones out', () => {
    const registry = createPlayerOptionsRegistry<Ctx>();
    registry.register('P10', [row('p10.trim', 'tools', 10)]);
    registry.register('P1', [row('p1.stop', 'playback', 10), row('p1.orientation', 'video', 10)]);
    assert.deepEqual(ids(registry), [
      ['playback', ['p1.stop']],
      ['video', ['p1.orientation']],
      ['tools', ['p10.trim']],
    ]);
  });

  it('sorts by order inside a section; equal orders keep the registration order', () => {
    const registry = createPlayerOptionsRegistry<Ctx>();
    registry.register('A', [row('a.late', 'playback', 30), row('a.first', 'playback', 10)]);
    registry.register('B', [row('b.between', 'playback', 20), row('b.tie', 'playback', 30)]);
    assert.deepEqual(ids(registry), [['playback', ['a.first', 'b.between', 'a.late', 'b.tie']]]);
  });

  it('refuses a row id another package owns, and leaves that package untouched', () => {
    const registry = createPlayerOptionsRegistry<Ctx>();
    registry.register('P1', [row('p1.stop', 'playback', 10)]);
    assert.throws(() => registry.register('P14', [row('p1.stop', 'audio', 10)]), PlayerOptionsRegistryError);
    assert.deepEqual(ids(registry), [['playback', ['p1.stop']]]);
  });

  it('refuses bad rows: no id, the same id twice, an unknown section, no order, no owner', () => {
    const registry = createPlayerOptionsRegistry<Ctx>();
    assert.throws(() => registry.register('X', [row(' ', 'playback', 1)]), PlayerOptionsRegistryError);
    assert.throws(() => registry.register('X', [row('x.a', 'playback', 1), row('x.a', 'video', 2)]), PlayerOptionsRegistryError);
    assert.throws(() => registry.register('X', [row('x.a', 'extras' as Row['section'], 1)]), PlayerOptionsRegistryError);
    assert.throws(() => registry.register('X', [row('x.a', 'playback', Number.NaN)]), PlayerOptionsRegistryError);
    assert.throws(() => registry.register(' ', [row('x.a', 'playback', 1)]), PlayerOptionsRegistryError);
    assert.deepEqual(registry.all(), []);
  });

  it('replaces an owner\'s rows when it registers again (Fast Refresh), and removes them on unregister', () => {
    const registry = createPlayerOptionsRegistry<Ctx>();
    const first = registry.register('P1', [row('p1.stop', 'playback', 10), row('p1.old', 'video', 10)]);
    const second = registry.register('P1', [row('p1.stop', 'playback', 10)]);
    assert.deepEqual(ids(registry), [['playback', ['p1.stop']]]);
    first(); // a stale unregister does not remove the newer rows
    assert.deepEqual(ids(registry), [['playback', ['p1.stop']]]);
    second();
    assert.deepEqual(registry.sections({ ready: true, incoming: false }), []);
  });

  it('hides rows whose visible() is false, and reports enabled() and value()', () => {
    const registry = createPlayerOptionsRegistry<Ctx>();
    registry.register('P1', [
      row('p1.save', 'tools', 10, { visible: (ctx) => ctx.incoming }),
      row('p1.stop', 'playback', 10, { enabled: (ctx) => ctx.ready, value: () => '10 seconds' }),
    ]);
    const notReady = registry.sections({ ready: false, incoming: false });
    assert.deepEqual(notReady.map((view) => view.section), ['playback']);
    assert.equal(notReady[0]!.rows[0]!.enabled, false);
    assert.equal(notReady[0]!.rows[0]!.value, '10 seconds');
    assert.deepEqual(ids(registry, { ready: true, incoming: true }), [
      ['playback', ['p1.stop']],
      ['tools', ['p1.save']],
    ]);
  });
});

describe('options sheet registry: on / off rows', () => {
  it("reports a toggle row's state (null for a command row) and keeps its subtitle", () => {
    const registry = createPlayerOptionsRegistry<Ctx>();
    registry.register('P2', [
      row('p2.info', 'video', 20, { toggle: (ctx) => ctx.ready, subtitle: 'p2.info.hint' }),
      row('p2.fit', 'video', 10, { value: () => 'Fit' }),
    ]);
    const rows = registry.sections({ ready: true, incoming: false })[0]!.rows;
    assert.deepEqual(
      rows.map((entry) => [entry.row.id, entry.toggle, entry.value, entry.row.subtitle ?? null]),
      [
        ['p2.fit', null, 'Fit', null],
        ['p2.info', true, null, 'p2.info.hint'],
      ],
    );
    assert.equal(registry.sections({ ready: false, incoming: false })[0]!.rows[1]!.toggle, false);
  });
});

describe('P1 rows in the options sheet', () => {
  const calls: string[] = [];
  const ui: PlayerOptionUi = {
    stop: () => calls.push('stop'),
    openJumpToTime: () => calls.push('jump'),
    openSeekInterval: () => calls.push('interval'),
    openFrameByFrame: () => calls.push('frame'),
    openOrientation: () => calls.push('orientation'),
    openSpeed: () => calls.push('speed'),
    saveToLibrary: () => calls.push('save'),
    seekTo: () => calls.push('seek'),
    notAvailableYet: () => calls.push('notYet'),
    openAspectRatio: () => calls.push('aspectRatio'),
    openMirrorFlip: () => calls.push('mirrorFlip'),
    setFillCutout: (on) => calls.push(`fillCutout:${on}`),
    setInfoOverlay: (on) => calls.push(`infoOverlay:${on}`),
  };
  const context = (overrides: Partial<PlayerOptionContext> = {}): PlayerOptionContext => ({
    t: ((key: string, params?: Record<string, string | number>) =>
      params ? `${key}(${Object.values(params).join(',')})` : key) as PlayerOptionContext['t'],
    mediaId: 'm1',
    player: {} as PlayerOptionContext['player'],
    controller: {} as PlayerOptionContext['controller'],
    session: { isReady: true, isPlaying: true, hasError: false, positionSeconds: 12, durationSeconds: 60, playbackRate: 1 },
    seekStepSeconds: 10,
    orientationMode: 'auto',
    incoming: null,
    display: { fit: 'fit', mirror: 'none', fillCutout: false, infoOverlay: false },
    ui,
    ...overrides,
  });

  it('puts Stop, Jump to time, Seek interval and Frame by frame under Playback, the orientation lock under Video', () => {
    const view = playerOptions.sections(context()).map((section) => [section.section, section.rows.map((entry) => entry.row.id)]);
    assert.deepEqual(view, [
      ['playback', ['p1.stop', 'p1.jumpToTime', 'p1.seekInterval', 'p1.frameByFrame']],
      ['video', ['p1.orientation']],
    ]);
    assert.ok(playerOptions.all().every((entry) => entry.owner === P1_OWNER));
  });

  it('shows the interval and the orientation as values, and Save to VidoraX only for an unsaved file from another app', () => {
    const sections = playerOptions.sections(context({ seekStepSeconds: 30, orientationMode: 'landscape' }));
    const values = Object.fromEntries(sections.flatMap((s) => s.rows.map((entry) => [entry.row.id, entry.value])));
    assert.equal(values['p1.seekInterval'], 'videoPlayer.seekIntervalOption(30)');
    assert.equal(values['p1.orientation'], 'player.orientation.landscape');
    const tools = (saveState: 'idle' | 'saving' | 'saved') =>
      playerOptions.sections(context({ incoming: { saveState } })).find((s) => s.section === 'tools')?.rows.map((e) => e.row.id);
    assert.deepEqual(tools('idle'), ['p1.saveToLibrary']);
    assert.equal(tools('saved'), undefined);
  });

  it('greys the commands out until the video is ready; interval and orientation stay usable', () => {
    const rows = playerOptions
      .sections(context({ session: { ...context().session, isReady: false } }))
      .flatMap((s) => s.rows.map((entry) => [entry.row.id, entry.enabled] as const));
    assert.deepEqual(Object.fromEntries(rows), {
      'p1.stop': false,
      'p1.jumpToTime': false,
      'p1.seekInterval': true,
      'p1.frameByFrame': false,
      'p1.orientation': true,
    });
  });

  it('runs the Player screen command each row stands for', () => {
    calls.length = 0;
    const ctx = context({ incoming: { saveState: 'idle' } });
    for (const option of P1_PLAYER_OPTIONS) {
      option.onPress(ctx);
    }
    assert.deepEqual(calls, ['stop', 'jump', 'interval', 'frame', 'orientation', 'save']);
  });

  it('lets another package add Playback and Audio rows next to P1\'s without touching them', () => {
    const unregister = playerOptions.register('P14-test', [
      { id: 'p14.sleepTimer', section: 'playback', order: 50, label: 'videoPlayer.stop', icon: 'timer', onPress: () => {} },
      { id: 'p14.audioTrack', section: 'audio', order: 10, label: 'videoPlayer.chipAudio', icon: 'music', onPress: () => {} },
    ]);
    try {
      const view = playerOptions.sections(context()).map((section) => [section.section, section.rows.map((entry) => entry.row.id)]);
      assert.deepEqual(view, [
        ['playback', ['p1.stop', 'p1.jumpToTime', 'p1.seekInterval', 'p1.frameByFrame', 'p14.sleepTimer']],
        ['video', ['p1.orientation']],
        ['audio', ['p14.audioTrack']],
      ]);
      assert.throws(
        () => playerOptions.register('P14-test-2', [{ ...P1_PLAYER_OPTIONS[0]!, label: 'videoPlayer.chipAudio' }]),
        PlayerOptionsRegistryError,
      );
    } finally {
      unregister();
    }
  });
});
