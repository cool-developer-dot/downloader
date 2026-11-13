import assert from 'node:assert/strict';
import { describe, test } from 'node:test';

import { createInFlightGuard } from './thumbnail-save';

describe('Save thumbnail in-flight guard (audit)', () => {
  test('a second tap while the first save runs saves nothing; afterwards it may run again', async () => {
    const guard = createInFlightGuard();
    let runs = 0;
    let finish: () => void = () => {};
    const first = guard('a', () => new Promise<void>((resolve) => {
      runs += 1;
      finish = resolve;
    }));
    assert.equal(await guard('a', async () => void (runs += 1)), false);
    assert.equal(await guard('b', async () => void (runs += 1)), true);
    finish();
    assert.equal(await first, true);
    assert.equal(await guard('a', async () => void (runs += 1)), true);
    assert.equal(runs, 3);
  });

  test('a failing save releases the guard', async () => {
    const guard = createInFlightGuard();
    await assert.rejects(guard('a', async () => {
      throw new Error('io');
    }));
    assert.equal(await guard('a', async () => {}), true);
  });
});
