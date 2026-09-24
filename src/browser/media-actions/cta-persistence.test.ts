import assert from 'node:assert/strict';
import test from 'node:test';

import { takeVerifyRerun, type VerifyRerunBudget } from './cta-persistence.ts';

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
