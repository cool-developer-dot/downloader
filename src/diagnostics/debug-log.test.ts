import assert from 'node:assert/strict';
import { describe, test } from 'node:test';

import { createDebugLogBuffer, debugLogToText, redactLogMessage } from './debug-log';

describe('redactLogMessage', () => {
  test('URLs become hosts', () => {
    assert.equal(
      redactLogMessage('fetch https://cdn.example.com/a/b.mp4?token=x&sig=y failed'),
      'fetch [cdn.example.com] failed',
    );
  });

  test('tokens, cookies and signatures are dropped', () => {
    const text = redactLogMessage('token=abc cookie: "sid=1; c=2" Authorization: Bearer xyz sig=q api_key=K X-Amz-Signature=s');
    for (const secret of ['abc', 'sid=1', 'xyz', ' q', 'K', '=s']) {
      assert.ok(!text.includes(secret), `${secret} leaked: ${text}`);
    }
    assert.ok(text.includes('token=[redacted]'));
  });

  test('a bare query string is dropped', () => {
    assert.equal(redactLogMessage('path /p?a=1&b=2 done'), 'path /p?[redacted] done');
  });

  test('long messages are cut', () => {
    assert.ok(redactLogMessage('x'.repeat(1000)).length <= 300);
  });
});

describe('createDebugLogBuffer', () => {
  test('keeps the newest entries up to its capacity', () => {
    const buffer = createDebugLogBuffer(3);
    for (let i = 1; i <= 5; i += 1) {
      buffer.add('test', `m${i}`, i);
    }
    assert.deepEqual(buffer.entries().map((e) => e.message), ['m3', 'm4', 'm5']);
    buffer.clear();
    assert.equal(buffer.entries().length, 0);
  });

  test('redacts on the way in', () => {
    const buffer = createDebugLogBuffer(5);
    buffer.add('net', 'GET https://example.com/x?token=1', 0);
    assert.equal(buffer.entries()[0]?.message, 'GET [example.com]');
  });

  test('text output is oldest first with timestamps', () => {
    const text = debugLogToText([{ at: 0, source: 's', message: 'hello' }], 'Debug log');
    assert.equal(text, 'Debug log\n\n1970-01-01T00:00:00.000Z [s] hello');
  });
});
