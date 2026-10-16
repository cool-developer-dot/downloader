import assert from 'node:assert/strict';
import { beforeEach, describe, test } from 'node:test';

import {
  allTags,
  cleanNote,
  hasTag,
  MAX_NOTE_LENGTH,
  MAX_TAG_LENGTH,
  MAX_TAGS_PER_ITEM,
  matchesSize,
  normalizeSizeBucket,
  normalizeTags,
  sizeBucketOf,
  tagProblem,
} from './item-organize';
import { forgetItemOrganize, useItemNotesStore, useItemTagsStore, useOrganizeFiltersStore } from './item-organize-store';

const MB = 1024 * 1024;
const GB = 1024 * MB;

describe('H12 tags', () => {
  beforeEach(() => useItemTagsStore.setState({ tagsById: {} }));

  test('a tag is trimmed, not empty, at most 30 characters, once per video (any case), at most 20', () => {
    assert.equal(tagProblem([], '  '), 'empty');
    assert.equal(tagProblem([], 'x'.repeat(MAX_TAG_LENGTH + 1)), 'too-long');
    assert.equal(tagProblem(['Music'], ' music '), 'duplicate');
    assert.equal(tagProblem(Array.from({ length: MAX_TAGS_PER_ITEM }, (_, i) => `t${i}`), 'new'), 'too-many');
    assert.equal(tagProblem(['Music'], 'Cooking'), null);
    assert.deepEqual(normalizeTags(['  a  b ', 'A  B', 7, '', 'c']), ['a b', 'c']);
    assert.deepEqual(normalizeTags('nope'), []);
  });

  test('adding, removing and forgetting', () => {
    const tags = useItemTagsStore.getState();
    assert.equal(tags.addTag('v1', ' Music '), true);
    assert.equal(tags.addTag('v1', 'music'), false);
    assert.equal(useItemTagsStore.getState().addTag('v2', 'Music'), true);
    assert.deepEqual(useItemTagsStore.getState().tagsById, { v1: ['Music'], v2: ['Music'] });
    useItemTagsStore.getState().removeTag('v1', 'MUSIC');
    assert.deepEqual(useItemTagsStore.getState().tagsById, { v2: ['Music'] });
    useItemTagsStore.getState().forget(['v2', 'unknown']);
    assert.deepEqual(useItemTagsStore.getState().tagsById, {});
  });

  test('every tag in use once, sorted, with its count; matching ignores case', () => {
    assert.deepEqual(allTags({ a: ['zoo', 'Music'], b: ['music'], c: [] }), [
      { tag: 'Music', count: 2 },
      { tag: 'zoo', count: 1 },
    ]);
    assert.equal(hasTag(['Music'], 'MUSIC'), true);
    assert.equal(hasTag(undefined, 'x'), false);
  });
});

describe('H12 notes', () => {
  beforeEach(() => useItemNotesStore.setState({ notesById: {} }));

  test('a note is trimmed and at most 1,000 characters; an empty note removes it', () => {
    assert.equal(cleanNote('  hello \n'), 'hello');
    assert.equal(cleanNote('x'.repeat(MAX_NOTE_LENGTH + 50)).length, MAX_NOTE_LENGTH);
    useItemNotesStore.getState().setNote('v1', '  Watch later ');
    assert.deepEqual(useItemNotesStore.getState().notesById, { v1: 'Watch later' });
    useItemNotesStore.getState().setNote('v1', '   ');
    assert.deepEqual(useItemNotesStore.getState().notesById, {});
  });

  test('deleting an item forgets its tags and its note', () => {
    useItemNotesStore.getState().setNote('v1', 'n');
    useItemNotesStore.getState().setNote('v2', 'keep');
    useItemTagsStore.setState({ tagsById: { v1: ['a'], v2: ['b'] } });
    forgetItemOrganize(['v1']);
    assert.deepEqual(useItemNotesStore.getState().notesById, { v2: 'keep' });
    assert.deepEqual(useItemTagsStore.getState().tagsById, { v2: ['b'] });
  });
});

describe('H12 size filter', () => {
  test('the four ranges and their edges', () => {
    assert.equal(sizeBucketOf(String(49 * MB)), 'under50');
    assert.equal(sizeBucketOf(50 * MB), '50to500');
    assert.equal(sizeBucketOf(500 * MB - 1), '50to500');
    assert.equal(sizeBucketOf(500 * MB), '500to2g');
    assert.equal(sizeBucketOf(2 * GB - 1), '500to2g');
    assert.equal(sizeBucketOf(2 * GB), 'over2g');
  });

  test('an unknown size only appears under All', () => {
    for (const unknown of ['0', '', 'abc', null, undefined, -5]) {
      assert.equal(sizeBucketOf(unknown), null);
      assert.equal(matchesSize(unknown, 'all'), true);
      assert.equal(matchesSize(unknown, 'under50'), false);
      assert.equal(matchesSize(unknown, 'over2g'), false);
    }
    assert.equal(matchesSize(String(3 * GB), 'over2g'), true);
    assert.equal(matchesSize(String(3 * GB), 'under50'), false);
    assert.equal(normalizeSizeBucket('huge'), 'all');
  });

  test('nothing chosen is the default', () => {
    const filters = useOrganizeFiltersStore.getState();
    assert.equal(filters.downloadsSize, 'all');
    assert.equal(filters.downloadsTag, null);
    assert.equal(filters.playerTag, null);
  });
});
