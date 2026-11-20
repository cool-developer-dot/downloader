import assert from 'node:assert/strict';
import { test } from 'node:test';

import { parseJsonLdComments, parseRedditComments, redditCommentsJsonUrl } from './comments-core';

test('Reddit: a post page maps to its public JSON, and the comment tree is read in order with depths', () => {
  assert.equal(
    redditCommentsJsonUrl('https://old.reddit.com/r/videos/comments/abc123/some_title/?utm=1'),
    'https://www.reddit.com/r/videos/comments/abc123.json?limit=500&raw_json=1',
  );
  assert.equal(redditCommentsJsonUrl('https://www.reddit.com/r/videos/'), null);
  assert.equal(redditCommentsJsonUrl('https://notreddit.com/r/a/comments/x'), null);
  const json = [
    { data: { children: [{ kind: 't3', data: { title: 'post' } }] } },
    {
      data: {
        children: [
          {
            kind: 't1',
            data: {
              author: 'ann',
              body: 'First &amp; best',
              score: 12,
              created_utc: 1_700_000_000,
              replies: { data: { children: [{ kind: 't1', data: { author: '[deleted]', body: 'reply', score: 1 } }, { kind: 'more', data: {} }] } },
            },
          },
          { kind: 't1', data: { author: 'bob', body: '[removed]' } },
        ],
      },
    },
  ];
  assert.deepEqual(parseRedditComments(json), [
    { author: 'ann', text: 'First & best', date: '2023-11-14T22:13:20.000Z', likes: 12, depth: 0 },
    { author: null, text: 'reply', date: null, likes: 1, depth: 1 },
  ]);
});

test('JSON-LD: comments of a video or post, with replies, likes and dates; broken blocks are skipped', () => {
  const html = `
    <script type="application/ld+json">{ broken </script>
    <script type="application/ld+json">
      {"@context":"https://schema.org","@type":"VideoObject","name":"Clip",
       "comment":[{"@type":"Comment","text":"Nice <b>clip</b>","author":{"@type":"Person","name":"Ann"},"dateCreated":"2026-01-02T03:04:05Z",
         "upvoteCount":4,"comment":{"@type":"Comment","text":"Agreed","author":"Bob"}}]}
    </script>
    <script type='application/ld+json'>
      {"@graph":[{"@type":"DiscussionForumPosting","comment":[{"@type":["Comment"],"text":"Third",
        "interactionStatistic":{"interactionType":"https://schema.org/LikeAction","userInteractionCount":7}}]}]}
    </script>`;
  assert.deepEqual(parseJsonLdComments(html), [
    { author: 'Ann', text: 'Nice clip', date: '2026-01-02T03:04:05.000Z', likes: 4, depth: 0 },
    { author: 'Bob', text: 'Agreed', date: null, likes: null, depth: 1 },
    { author: null, text: 'Third', date: null, likes: 7, depth: 0 },
  ]);
  assert.deepEqual(parseJsonLdComments('<html>no data</html>'), []);
});
