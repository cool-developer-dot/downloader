import assert from 'node:assert/strict';
import { describe, test } from 'node:test';

import { BACKUP_FORMAT, BACKUP_LIMITS, backupJson, parseBackup, type BrowserBackup } from './data-backup';

const backup: BrowserBackup = {
  exportedAt: '2026-11-01T10:00:00.000Z',
  settings: { language: 'ur', wifiOnly: true },
  profiles: [
    {
      id: 'default',
      name: '',
      color: 'blue',
      browserSettings: { searchEngine: 'duckduckgo' },
      bookmarks: [{ url: 'https://ur.wikipedia.org/', title: 'ویکیپیڈیا', createdAt: '2026-10-01T00:00:00.000Z' }],
      history: [{ url: 'https://example.com/a?q=1', title: 'Example', visitedAt: '2026-10-31T12:00:00.000Z' }],
      searches: [{ query: 'lahore weather', searchedAt: '2026-10-30T08:00:00.000Z' }],
    },
    {
      id: 'pwork0001',
      name: 'Work',
      color: 'green',
      browserSettings: {},
      bookmarks: [],
      history: [],
      searches: [],
    },
  ],
};

describe('browser backup', () => {
  test('round trip keeps everything', () => {
    const parsed = parseBackup(backupJson(backup));
    assert.equal(parsed.ok, true);
    if (!parsed.ok) return;
    assert.deepEqual(parsed.backup, backup);
    assert.deepEqual(parsed.counts, { profiles: 2, bookmarks: 1, history: 1, searches: 1 });
  });

  test('refuses what is not a backup, and a newer format', () => {
    assert.deepEqual(parseBackup('not json'), { ok: false, reason: 'not-json' });
    assert.deepEqual(parseBackup('[]'), { ok: false, reason: 'wrong-format' });
    assert.deepEqual(parseBackup(JSON.stringify({ format: 'vidorax.settings', version: 1, settings: {} })), {
      ok: false,
      reason: 'wrong-format',
    });
    assert.deepEqual(parseBackup(JSON.stringify({ format: BACKUP_FORMAT, version: 2, profiles: [] })), {
      ok: false,
      reason: 'unsupported-version',
    });
    assert.deepEqual(parseBackup(JSON.stringify({ format: BACKUP_FORMAT, version: 1.5, profiles: [] })), {
      ok: false,
      reason: 'wrong-format',
    });
  });

  test('a file from elsewhere: only web addresses, valid dates and clean text get in', () => {
    const hostile = {
      format: BACKUP_FORMAT,
      version: 1,
      exportedAt: 'yesterday',
      settings: { ok: 'yes', nested: { a: 1 }, huge: 'x'.repeat(BACKUP_LIMITS.settingString + 1), f: () => 1 },
      profiles: [
        {
          id: 'default',
          bookmarks: [
            { url: 'javascript:alert(1)', title: 'x', createdAt: '2026-01-01T00:00:00Z' },
            { url: 'file:///sdcard/a', title: 'x' },
            { url: 'https://ok.example/', title: '‮gnp.exe\u0000', createdAt: 'not a date' },
            { url: `https://long.example/${'a'.repeat(BACKUP_LIMITS.urlLength)}`, title: 'x' },
          ],
          history: [
            { url: 'https://ok.example/', title: 'ok', visitedAt: '2026-10-01T00:00:00Z' },
            { url: 'https://ok.example/', title: 'no date' },
            { url: 'https://ok.example/', title: 'future', visitedAt: '2099-01-01T00:00:00Z' },
          ],
          searches: [{ query: '   ', searchedAt: '2026-10-01T00:00:00Z' }, { query: 'ok', searchedAt: '2026-10-01T00:00:00Z' }],
        },
        { id: 'guest', name: 'Guest', bookmarks: [{ url: 'https://guest.example/', title: 'g' }] },
        { id: '../etc', name: 'Bad', bookmarks: [] },
      ],
    };
    const parsed = parseBackup(JSON.stringify(hostile));
    assert.equal(parsed.ok, true);
    if (!parsed.ok) return;
    assert.deepEqual(parsed.backup.profiles.map((p) => p.id), ['default']);
    const profile = parsed.backup.profiles[0];
    assert.deepEqual(profile.bookmarks.map((b) => b.url), ['https://ok.example/']);
    assert.equal(profile.bookmarks[0].title, 'gnp.exe');
    assert.equal(profile.bookmarks[0].createdAt, new Date(0).toISOString());
    assert.deepEqual(profile.history.map((h) => h.title), ['ok']);
    assert.deepEqual(profile.searches.map((s) => s.query), ['ok']);
    assert.deepEqual(parsed.backup.settings, { ok: 'yes' });
    assert.equal(parsed.backup.exportedAt, new Date(0).toISOString());
  });

  test('counts are capped per profile', () => {
    const many = {
      format: BACKUP_FORMAT,
      version: 1,
      profiles: [
        {
          id: 'default',
          searches: Array.from({ length: BACKUP_LIMITS.searchesPerProfile + 10 }, (_, i) => ({
            query: `q${i}`,
            searchedAt: '2026-10-01T00:00:00Z',
          })),
        },
      ],
    };
    const parsed = parseBackup(JSON.stringify(many));
    assert.equal(parsed.ok && parsed.backup.profiles[0].searches.length, BACKUP_LIMITS.searchesPerProfile);
  });

  test('accepts a byte order mark', () => {
    assert.equal(parseBackup(`﻿${backupJson(backup)}`).ok, true);
  });
});
