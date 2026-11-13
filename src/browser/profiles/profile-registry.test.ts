import assert from 'node:assert/strict';
import { describe, test } from 'node:test';

import {
  checkProfileName,
  cleanProfileName,
  DEFAULT_PROFILE,
  MAX_PROFILES,
  newProfileId,
  nextProfileColor,
  parseProfiles,
  profileDisplayName,
  profileInitials,
  type BrowserProfile,
} from './profile-registry';

const work: BrowserProfile = { id: 'pwork0001', name: 'Work', color: 'green', createdAt: 1 };

describe('parseProfiles', () => {
  test('nothing stored: only the default profile', () => {
    assert.deepEqual(parseProfiles(undefined), [{ id: 'default', name: '', color: 'blue', createdAt: 0 }]);
    assert.deepEqual(parseProfiles('junk').map((p) => p.id), ['default']);
  });

  test('keeps the default first and drops guest, bad ids, duplicates and nameless profiles', () => {
    const parsed = parseProfiles([
      work,
      { id: 'guest', name: 'Guest', color: 'red', createdAt: 2 },
      { id: 'Bad-Id', name: 'X', color: 'red', createdAt: 2 },
      { id: 'pwork0001', name: 'Again', color: 'red', createdAt: 3 },
      { id: 'pnoname01', name: '   ', color: 'red', createdAt: 3 },
      { id: 'default', name: 'Me', color: 'purple', createdAt: 0 },
      { id: 'pwork0002', name: 'WORK', color: 'teal', createdAt: 4 },
    ]);
    assert.deepEqual(parsed.map((p) => p.id), ['default', 'pwork0001']);
    assert.equal(parsed[0].name, 'Me');
    assert.equal(parsed[0].color, 'purple');
  });

  test('repairs fields and caps the count', () => {
    const many = Array.from({ length: 9 }, (_, i) => ({ id: `p${i}`, name: `P ${i}`, color: 'nope', createdAt: 'x' }));
    const parsed = parseProfiles(many);
    assert.equal(parsed.length, MAX_PROFILES);
    assert.equal(parsed[1].color, 'blue');
    assert.equal(parsed[1].createdAt, 0);
  });

  test('strips invisible and direction-override characters from names', () => {
    const parsed = parseProfiles([{ id: 'p1', name: 'Wo‮rk\u0007  team', color: 'red', createdAt: 0 }]);
    assert.equal(parsed[1].name, 'Work team');
  });
});

describe('checkProfileName', () => {
  const profiles = parseProfiles([work]);

  test('accepts a clean new name', () => {
    assert.deepEqual(checkProfileName('  School  ', profiles, { defaultName: 'Personal' }), { ok: true, name: 'School' });
  });

  test('refuses empty, too long and taken names (case-insensitive, the default profile by its shown name)', () => {
    assert.deepEqual(checkProfileName('   ', profiles, { defaultName: 'Personal' }), { ok: false, reason: 'empty' });
    assert.deepEqual(checkProfileName('x'.repeat(31), profiles, { defaultName: 'Personal' }), { ok: false, reason: 'too-long' });
    assert.deepEqual(checkProfileName('work', profiles, { defaultName: 'Personal' }), { ok: false, reason: 'taken' });
    assert.deepEqual(checkProfileName('PERSONAL', profiles, { defaultName: 'Personal' }), { ok: false, reason: 'taken' });
  });

  test('a profile keeps its own name when renamed', () => {
    assert.equal(checkProfileName('Work', profiles, { exceptId: 'pwork0001', defaultName: 'Personal' }).ok, true);
    assert.equal(checkProfileName('Personal', profiles, { exceptId: DEFAULT_PROFILE, defaultName: 'Personal' }).ok, true);
  });

  test('Urdu names work like any other', () => {
    assert.deepEqual(checkProfileName('کام', profiles, { defaultName: 'ذاتی' }), { ok: true, name: 'کام' });
    assert.deepEqual(checkProfileName('ذاتی', profiles, { defaultName: 'ذاتی' }), { ok: false, reason: 'taken' });
  });
});

describe('colours, ids, names', () => {
  test('the next colour is the first unused one', () => {
    assert.equal(nextProfileColor(parseProfiles([])), 'green');
    assert.equal(nextProfileColor(parseProfiles([work])), 'purple');
  });

  test('new ids are valid, unused and never guest or default', () => {
    const profiles = parseProfiles([work]);
    let calls = 0;
    const id = newProfileId(profiles, () => {
      calls += 1;
      return calls === 1 ? 0 : 0.5;
    });
    assert.match(id, /^p[a-z0-9]{8}$/);
    assert.ok(!profiles.some((p) => p.id === id));
  });

  test('display names and initials', () => {
    assert.equal(profileDisplayName(parseProfiles([])[0], 'Personal'), 'Personal');
    assert.equal(profileDisplayName(work, 'Personal'), 'Work');
    assert.equal(profileInitials('work'), 'W');
    assert.equal(profileInitials('Home  office'), 'HO');
    assert.equal(profileInitials('کام کاج'), 'کک');
    assert.equal(profileInitials(''), '?');
    assert.equal(cleanProfileName('a\nb'), 'a b');
  });
});
