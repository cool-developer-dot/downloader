/**
 * P7 — playlist names, import matching (#629), what an entry is now (missing / device), and what playing opens
 * (#618: through the play queue, missing entries left out).
 */

import assert from 'node:assert/strict';
import { describe, it } from 'node:test';

import { matchImportEntries, type ImportCandidate } from './import-match.ts';
import { parseM3u } from './m3u.ts';
import { planPlaylistPlay } from './play-plan.ts';
import { isDeviceEntryId, resolvePlaylistEntries, type EntryLibraryInfo } from './playlist-entries.ts';
import {
  normalizePlaylistName,
  playlistExportFileName,
  playlistNameFromFileName,
  suggestPlaylistName,
  uniquePlaylistName,
} from './playlist-names.ts';

import type { PlaylistItem } from '@/storage/repositories/playlists.queries';

const LF = String.fromCharCode(10);
const TAB = String.fromCharCode(9);

describe('P7 playlist names', () => {
  it('normalizes what the user types; control characters become spaces; 80 characters at most', () => {
    assert.equal(normalizePlaylistName(`  Road${TAB}trip${LF} 2026 `), 'Road trip 2026');
    assert.equal(normalizePlaylistName('   '), '');
    assert.equal(normalizePlaylistName('سفر  نامہ'), 'سفر نامہ');
    assert.equal(Array.from(normalizePlaylistName('😀'.repeat(100))).length, 80, 'no emoji cut in half');
  });

  it('an imported name is made unique; the dialog suggests the first free number', () => {
    assert.equal(uniquePlaylistName('Mix', ['Other']), 'Mix');
    assert.equal(uniquePlaylistName('Mix', ['mix', 'Mix (2)']), 'Mix (3)');
    assert.equal(suggestPlaylistName(['Playlist 1', 'playlist 2'], (n) => `Playlist ${n}`), 'Playlist 3');
    assert.equal(suggestPlaylistName([], (n) => `پلے لسٹ ${n}`), 'پلے لسٹ 1');
  });

  it('the imported file name without folders and extension; the export file name keeps Urdu', () => {
    assert.equal(playlistNameFromFileName('Road trip.m3u8'), 'Road trip');
    assert.equal(playlistNameFromFileName('C:\\Lists\\mix.M3U'), 'mix');
    assert.equal(playlistNameFromFileName('/sdcard/سفر.m3u'), 'سفر');
    assert.equal(playlistNameFromFileName(null), '');
    assert.equal(playlistExportFileName('میری فہرست'), 'میری فہرست.m3u8');
    assert.equal(playlistExportFileName('a/b: c*?'), 'a b c.m3u8');
    assert.equal(playlistExportFileName('...hidden'), 'hidden.m3u8');
    assert.equal(playlistExportFileName('???'), 'playlist.m3u8');
  });
});

const candidate = (id: string, fileName: string, path: string | null = null, playable = true): ImportCandidate => ({
  id,
  fileName,
  path,
  playable,
});

describe('P7 import matching (#629)', () => {
  const library = [
    candidate('a', 'Clip.mp4', 'file:///data/user/0/com.vidorax/files/library/a/Clip.mp4'),
    candidate(
      'b',
      'Clip.mp4',
      'content://com.android.externalstorage.documents/tree/primary%3AMovies/document/primary%3AMovies%2FVidoraX%2FCooking%2FClip.mp4',
    ),
    candidate('c', 'میرا گانا.mp4', 'file:///data/user/0/com.vidorax/files/library/c/%D9%85.mp4'),
    candidate('d', 'old.mkv', null, false),
    candidate('e', 'old.mkv', null, true),
  ];

  it('by path first (last folders + name), then by file name; case-insensitive; not found listed in order', () => {
    const parsed = parseM3u(
      [
        '#EXTM3U',
        '#EXTINF:10,Cooking clip',
        '/storage/emulated/0/Movies/VidoraX/Cooking/Clip.mp4',
        '#EXTINF:-1,Urdu',
        'Music/میرا گانا.MP4',
        'nothing-here.mp4',
        'CLIP.mp4',
        'https://example.com/web.mp4',
        'C:\\Users\\Ali\\Videos\\missing.webm',
      ].join(LF),
    );
    const result = matchImportEntries(parsed.entries, library);
    assert.deepEqual(
      result.matched.map((m) => [m.candidate.id, m.by]),
      [
        ['b', 'path'],
        ['c', 'name'],
        ['a', 'name'],
      ],
    );
    assert.deepEqual(
      result.notFound.map((e) => e.location),
      ['nothing-here.mp4', 'C:\\Users\\Ali\\Videos\\missing.webm'],
    );
    assert.equal(result.duplicates, 0);
    assert.equal(parsed.skippedRemote, 1);
  });

  it('a file name alone never matches by path; the extension must agree; the playable video of a shared name wins', () => {
    const result = matchImportEntries(parseM3u(['old.mkv', 'Clip.webm'].join(LF)).entries, library);
    assert.deepEqual(result.matched.map((m) => m.candidate.id), ['e']);
    assert.deepEqual(result.notFound.map((e) => e.location), ['Clip.webm']);
  });

  it('the same video twice is added once and counted as a duplicate', () => {
    const lines = ['Movies/VidoraX/Cooking/Clip.mp4', 'file:///x/Cooking/Clip.mp4', 'clip.mp4', 'clip.mp4', 'clip.mp4'];
    const result = matchImportEntries(parseM3u(lines.join(LF)).entries, library);
    // Two Clip.mp4 videos exist: the first line's folders take b; the second names a folder no video is in, so it
    // falls back to the name and takes a; the rest are the same name again (duplicates).
    assert.deepEqual(result.matched.map((m) => [m.candidate.id, m.by]), [
      ['b', 'path'],
      ['a', 'name'],
    ]);
    assert.equal(result.duplicates, 3);
    assert.deepEqual(result.notFound, []);
  });

  it('an empty library: everything is not found', () => {
    const result = matchImportEntries(parseM3u(['a.mp4', 'b.mp4'].join(LF)).entries, []);
    assert.equal(result.matched.length, 0);
    assert.equal(result.notFound.length, 2);
  });
});

const stored = (mediaId: string, position: number, title = `Stored ${mediaId}`): PlaylistItem => ({
  playlistId: 'p1',
  mediaId,
  position,
  title,
  fileName: `${mediaId}.mp4`,
  durationSeconds: 42,
  addedAt: 'x',
});

const media = (displayName: string, localAvailability: EntryLibraryInfo['localAvailability']): EntryLibraryInfo => ({
  displayName,
  fileName: `${displayName}.mp4`,
  duration: null,
  localAvailability,
  thumbnailUri: null,
});

describe('P7 entries: live names, missing files, device videos', () => {
  const items = [stored('v1', 0), stored('v2', 1), stored('gone', 2, 'Deleted clip'), stored('device:9', 3, 'Phone clip'), stored('device:10', 4), stored('v3', 5)];
  const library = new Map<string, EntryLibraryInfo>([
    ['v1', media('Live name', 'available')],
    ['v2', media('Missing file', 'missing')],
    ['v3', media('Not checked yet', 'unverified')],
  ]);
  const device = (id: string) => (id === 'device:10' ? { title: 'Listed phone video', durationMs: 90_000 } : null);
  const entries = resolvePlaylistEntries(items, { library, device });

  it('uses the library’s name when the video is there, else the stored one; says why one can’t play', () => {
    assert.deepEqual(
      entries.map((e) => [e.mediaId, e.title, e.playable, e.missing]),
      [
        ['v1', 'Live name', true, null],
        ['v2', 'Missing file', false, 'gone'],
        ['gone', 'Deleted clip', false, 'gone'],
        ['device:9', 'Phone clip', false, 'device'],
        ['device:10', 'Listed phone video', true, null],
        ['v3', 'Not checked yet', true, null],
      ],
    );
    assert.equal(entries[4]?.durationSeconds, 90);
    assert.equal(entries[2]?.durationSeconds, 42, 'the stored duration for a gone video');
    assert.ok(isDeviceEntryId('device:9'));
    assert.ok(!isDeviceEntryId('v1'));
  });

  it('playing skips the entries that can’t play; a tapped entry starts there; a missing tap plays nothing', () => {
    assert.deepEqual(planPlaylistPlay(entries), { startId: 'v1', ids: ['v1', 'device:10', 'v3'] });
    assert.deepEqual(planPlaylistPlay(entries, { startId: 'v3' }), { startId: 'v3', ids: ['v1', 'device:10', 'v3'] });
    assert.equal(planPlaylistPlay(entries, { startId: 'v2' }), null);
    assert.equal(planPlaylistPlay(entries.filter((e) => !e.playable)), null);
    assert.equal(planPlaylistPlay([]), null);
  });

  it('never puts the same id in the queue twice', () => {
    const plan = planPlaylistPlay([
      { mediaId: 'a', playable: true },
      { mediaId: 'a', playable: true },
      { mediaId: 'b', playable: true },
    ]);
    assert.deepEqual(plan?.ids, ['a', 'b']);
  });
});
