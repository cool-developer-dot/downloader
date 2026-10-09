import assert from 'node:assert/strict';
import test from 'node:test';

import { offerNavigationReset, takeVerifyRerun, type VerifyRerunBudget } from './cta-persistence.ts';

test('a verification the page overtook may look again, a bounded number of times per media/owner/page', () => {
  let budget: VerifyRerunBudget = { key: '', count: 0 };
  const allowed: boolean[] = [];
  for (let i = 0; i < 5; i += 1) {
    const next = takeVerifyRerun(budget, 'media-1|owner|page', 3);
    budget = next.budget;
    allowed.push(next.allowed);
  }
  assert.deepEqual(allowed, [true, true, true, false, false]);
});

test('anything new — other media, owner or page — gets a fresh budget', () => {
  let budget: VerifyRerunBudget = { key: 'media-1|owner|page', count: 3 };
  const next = takeVerifyRerun(budget, 'media-2|owner|page', 3);
  assert.equal(next.allowed, true);
  assert.deepEqual(next.budget, { key: 'media-2|owner|page', count: 1 });
  budget = next.budget;
  assert.equal(takeVerifyRerun(budget, 'media-2|owner|page', 3).allowed, true);
});

const REEL = 'https://www.facebook.com/watch/?v=4678791569058145&vanity=1';

test('a tab that leaves its page for the start page loses that page\'s offer', () => {
  // Reopening the same reel link later is a new load: the offer for the reel the old page showed last must not return.
  assert.equal(
    offerNavigationReset({ previous: REEL, next: null, nextIsHome: true, sameDocument: false, sameContent: false }),
    'LEFT_FOR_HOME',
  );
});

test('another document resets the offer; the same document or content keeps it', () => {
  const other = 'https://example.com/video';
  assert.equal(
    offerNavigationReset({ previous: REEL, next: other, nextIsHome: false, sameDocument: false, sameContent: false }),
    'NAVIGATED',
  );
  assert.equal(
    offerNavigationReset({ previous: REEL, next: REEL, nextIsHome: false, sameDocument: true, sameContent: false }),
    null,
  );
  assert.equal(
    offerNavigationReset({ previous: REEL, next: other, nextIsHome: false, sameDocument: false, sameContent: true }),
    null,
  );
});

test('arriving on a page from no page keeps the tab\'s offer (a tab switched back to)', () => {
  assert.equal(
    offerNavigationReset({ previous: null, next: REEL, nextIsHome: false, sameDocument: false, sameContent: false }),
    null,
  );
  assert.equal(
    offerNavigationReset({ previous: null, next: null, nextIsHome: true, sameDocument: false, sameContent: false }),
    null,
  );
  // No page for another reason than the start page (the pipeline between loads): nothing is withdrawn here.
  assert.equal(
    offerNavigationReset({ previous: REEL, next: null, nextIsHome: false, sameDocument: false, sameContent: false }),
    null,
  );
});
