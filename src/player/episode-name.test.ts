import assert from 'node:assert/strict';
import { describe, test } from 'node:test';

import { looksLikeNextEpisode, normalizeEpisodeName, parseEpisode } from './episode-name';
import {
  NEXT_EPISODE_MIN_DURATION_SECONDS,
  NEXT_EPISODE_PROMPT_SECONDS,
  nextEpisodePromptState,
  type NextEpisodePromptInput,
} from './next-episode-prompt';

describe('next episode names (#733)', () => {
  test('season and episode: the next one, or the first of the next season', () => {
    assert.ok(looksLikeNextEpisode('Show.S01E02.720p.mkv', 'Show.S01E03.720p.mkv'));
    assert.ok(looksLikeNextEpisode('Show S01E10', 'Show S02E01'));
    assert.ok(looksLikeNextEpisode('show s1e2', 'Show S01E03 The Return'));
    assert.ok(looksLikeNextEpisode('Show 1x02', 'Show 1x03'));
    assert.ok(!looksLikeNextEpisode('Show S01E02', 'Show S01E04'));
    assert.ok(!looksLikeNextEpisode('Show S01E02', 'Show S02E03'));
    assert.ok(!looksLikeNextEpisode('Show S01E02', 'Other Show S01E03'));
  });

  test('"Ep 3", "Episode 4", "E04" and Urdu "قسط": the next number of the same show', () => {
    assert.ok(looksLikeNextEpisode('Drama Ep 3', 'Drama Ep 4'));
    assert.ok(looksLikeNextEpisode('Drama Ep. 3', 'Drama Ep. 4'));
    assert.ok(looksLikeNextEpisode('Episode 4 - The Start', 'Episode 5 - The End'));
    assert.ok(looksLikeNextEpisode('Drama E04', 'Drama E05'));
    assert.ok(looksLikeNextEpisode('ڈرامہ قسط 5', 'ڈرامہ قسط 6'));
    assert.ok(!looksLikeNextEpisode('Drama Ep 3', 'Drama Ep 5'));
    assert.ok(!looksLikeNextEpisode('Drama Ep 3', 'Other Ep 4'));
  });

  test('the same name with the next number', () => {
    assert.ok(looksLikeNextEpisode('Drama 12.mp4', 'Drama 13.mp4'));
    assert.ok(looksLikeNextEpisode('Lecture_09 1080p', 'Lecture_10 1080p'));
    assert.ok(!looksLikeNextEpisode('Holiday 1', 'Work 2'));
    assert.ok(!looksLikeNextEpisode('Part 1 take 2', 'Part 2 take 3'), 'two numbers change');
    assert.ok(!looksLikeNextEpisode('Drama 12', 'Drama 12'));
    assert.ok(!looksLikeNextEpisode('Drama 13', 'Drama 12'));
  });

  test('nothing to compare', () => {
    assert.ok(!looksLikeNextEpisode(null, 'Drama 2'));
    assert.ok(!looksLikeNextEpisode('Drama 1', null));
    assert.ok(!looksLikeNextEpisode('Cat video', 'Dog video'));
  });

  test('names are compared without extension, case and separators', () => {
    assert.equal(normalizeEpisodeName('My.Show_S01E02-Final.MKV'), 'my show s01e02 final');
    assert.deepEqual(parseEpisode('My.Show.S01E02.mkv'), { show: 'my show', season: 1, episode: 2 });
    assert.deepEqual(parseEpisode('Episode 7'), { show: '', season: null, episode: 7 });
    assert.equal(parseEpisode('Holiday'), null);
  });
});

describe('Next Episode card timing (#733)', () => {
  const base: NextEpisodePromptInput = {
    enabled: true,
    upcoming: { kind: 'next', mediaId: 'ep3', reason: 'autoPlayNext' },
    currentTitle: 'Drama Ep 2',
    nextTitle: 'Drama Ep 3',
    positionSeconds: 595,
    durationSeconds: 600,
    cancelled: false,
    ready: true,
  };

  test(`shows in the last ${NEXT_EPISODE_PROMPT_SECONDS} s, counting down the seconds left`, () => {
    assert.deepEqual(nextEpisodePromptState(base), {
      visible: true,
      nextId: 'ep3',
      nextTitle: 'Drama Ep 3',
      secondsLeft: 5,
    });
    assert.deepEqual(nextEpisodePromptState({ ...base, positionSeconds: 590 }), {
      visible: true,
      nextId: 'ep3',
      nextTitle: 'Drama Ep 3',
      secondsLeft: 10,
    });
    assert.equal(nextEpisodePromptState({ ...base, positionSeconds: 589.9 }).visible, false);
    assert.equal(nextEpisodePromptState({ ...base, positionSeconds: 599.2 }).visible, true);
    assert.equal(nextEpisodePromptState({ ...base, positionSeconds: 600 }).visible, false, 'ended: the end decides');
  });

  test('only when the end is going to play the next episode anyway', () => {
    assert.equal(nextEpisodePromptState({ ...base, upcoming: { kind: 'stop' } }).visible, false);
    assert.equal(nextEpisodePromptState({ ...base, upcoming: { kind: 'replay', reason: 'repeatOne' } }).visible, false);
    assert.equal(nextEpisodePromptState({ ...base, upcoming: { kind: 'loop', seekSeconds: 3 } }).visible, false);
    assert.equal(nextEpisodePromptState({ ...base, nextTitle: 'Holiday clip' }).visible, false);
  });

  test('not when switched off, cancelled, not ready, or the video is short', () => {
    assert.equal(nextEpisodePromptState({ ...base, enabled: false }).visible, false);
    assert.equal(nextEpisodePromptState({ ...base, cancelled: true }).visible, false);
    assert.equal(nextEpisodePromptState({ ...base, ready: false }).visible, false);
    assert.equal(
      nextEpisodePromptState({
        ...base,
        durationSeconds: NEXT_EPISODE_MIN_DURATION_SECONDS - 1,
        positionSeconds: NEXT_EPISODE_MIN_DURATION_SECONDS - 3,
      }).visible,
      false,
    );
    assert.equal(nextEpisodePromptState({ ...base, durationSeconds: null }).visible, false);
  });
});
