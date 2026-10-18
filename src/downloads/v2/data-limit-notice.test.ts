import assert from 'node:assert/strict';
import { afterEach, describe, test } from 'node:test';

import {
  getDataLimitNoticePort,
  postDataLimitNotices,
  setDataLimitNoticePortForTests,
  type DataLimitNoticePort,
} from './data-limit-notice';
import type { DataLimitAlert } from './data-usage';

const DAY: DataLimitAlert = { period: 'day', usedBytes: 1_100, limitBytes: 1_000 };
const MONTH: DataLimitAlert = { period: 'month', usedBytes: 9_000, limitBytes: 8_000 };

function textFor(alert: DataLimitAlert) {
  return { title: `${alert.period} limit`, text: `${alert.usedBytes} of ${alert.limitBytes}` };
}

function fakePort(answer: (period: string) => boolean | Promise<boolean> = () => true) {
  const calls: { period: string; title: string; text: string }[] = [];
  const port: DataLimitNoticePort = {
    async showDataLimitNotification(period, title, text) {
      calls.push({ period, title, text });
      return answer(period);
    },
  };
  return { port, calls };
}

afterEach(() => setDataLimitNoticePortForTests(undefined));

describe('data limit notifications (#422)', () => {
  test('each crossed limit is posted once, with the in-app alert texts', async () => {
    const { port, calls } = fakePort();
    assert.equal(await postDataLimitNotices(port, [DAY, MONTH], textFor), 2);
    assert.deepEqual(calls, [
      { period: 'day', title: 'day limit', text: '1100 of 1000' },
      { period: 'month', title: 'month limit', text: '9000 of 8000' },
    ]);
  });

  test('nothing crossed, or no native function: nothing is posted', async () => {
    const { port, calls } = fakePort();
    assert.equal(await postDataLimitNotices(port, [], textFor), 0);
    assert.equal(calls.length, 0);
    assert.equal(await postDataLimitNotices(null, [DAY], textFor), 0);
  });

  test('a refused or failing notification never throws and does not stop the next one', async () => {
    const { port, calls } = fakePort((period) => {
      if (period === 'day') {
        throw new Error('native failure');
      }
      return false;
    });
    assert.equal(await postDataLimitNotices(port, [DAY, MONTH], textFor), 0);
    assert.equal(calls.length, 2);
  });

  test('a text that cannot be built skips that notification only', async () => {
    const { port, calls } = fakePort();
    const posted = await postDataLimitNotices(port, [DAY, MONTH], (alert) => {
      if (alert.period === 'day') {
        throw new Error('no catalog');
      }
      return textFor(alert);
    });
    assert.equal(posted, 1);
    assert.deepEqual(calls.map((call) => call.period), ['month']);
  });

  test('without the native module there is no port; a test port is used when set', () => {
    assert.equal(getDataLimitNoticePort(), null);
    const { port } = fakePort();
    setDataLimitNoticePortForTests(port);
    assert.equal(getDataLimitNoticePort(), port);
  });
});
