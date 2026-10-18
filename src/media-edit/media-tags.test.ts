import assert from 'node:assert/strict';
import { beforeEach, describe, test } from 'node:test';

import {
  MAX_ARTIST_LENGTH,
  MAX_TAGGED_ITEMS,
  normalizeArtist,
  normalizeArtistTags,
  withArtist,
  withoutArtists,
} from './media-tags';
import { useMediaTagsStore } from './media-tags-store';

beforeEach(() => {
  useMediaTagsStore.setState({ artists: {} });
});

describe('artist tags', () => {
  test('an artist is one trimmed line, capped, with Urdu kept whole', () => {
    assert.equal(normalizeArtist('  Atif   Aslam '), 'Atif Aslam');
    assert.equal(normalizeArtist('a\nb\tc'), 'a b c');
    assert.equal(normalizeArtist('عاطف اسلم'), 'عاطف اسلم');
    assert.equal(Array.from(normalizeArtist('ا'.repeat(500))).length, MAX_ARTIST_LENGTH);
    assert.equal(normalizeArtist(42), '');
  });

  test('setting, replacing and clearing an artist', () => {
    const one = withArtist({}, 'a', 'Singer');
    assert.deepEqual(one, { a: 'Singer' });
    assert.equal(withArtist(one, 'a', ' Singer '), one);
    assert.deepEqual(withArtist(one, 'a', 'Other'), { a: 'Other' });
    assert.deepEqual(withArtist(one, 'a', '   '), {});
    const empty = {};
    assert.equal(withArtist(empty, 'a', ''), empty);
  });

  test('tags are capped, the oldest dropped first', () => {
    let tags = {};
    for (let i = 0; i < MAX_TAGGED_ITEMS + 3; i += 1) {
      tags = withArtist(tags, `id${i}`, 'x');
    }
    assert.equal(Object.keys(tags).length, MAX_TAGGED_ITEMS);
    assert.equal('id0' in tags, false);
  });

  test('a deleted item\'s artist is forgotten', () => {
    const tags = { a: 'x', b: 'y' };
    assert.deepEqual(withoutArtists(tags, ['a', 'z']), { b: 'y' });
    assert.equal(withoutArtists(tags, ['z']), tags);
    useMediaTagsStore.getState().setArtist('a', 'Singer');
    useMediaTagsStore.getState().forget(['a']);
    assert.deepEqual(useMediaTagsStore.getState().artists, {});
  });

  test('stored tags are validated', () => {
    assert.deepEqual(normalizeArtistTags({ a: ' x ', b: '', c: 3 }), { a: 'x' });
    assert.deepEqual(normalizeArtistTags('nope'), {});
  });
});
