import assert from 'node:assert/strict';
import { describe, test } from 'node:test';

import {
  SUPPORT_EMAIL_ADDRESS,
  SUPPORT_EMAIL_SUBJECT,
  buildSupportEmailBody,
  buildSupportMailtoUrl,
} from './support-email';

const INFO = { appVersion: '2.0.0 (12)', androidVersion: '15 (API 35)', device: 'Google Pixel 8' };

describe('support email', () => {
  test('goes to the VidoraX support mailbox with the support subject', () => {
    const url = buildSupportMailtoUrl(INFO);
    assert.ok(url.startsWith(`mailto:${SUPPORT_EMAIL_ADDRESS}?`));
    assert.equal(SUPPORT_EMAIL_ADDRESS, 'Vidoraxlabs@gmail.com');
    const query = new URLSearchParams(url.slice(url.indexOf('?') + 1));
    assert.equal(query.get('subject'), SUPPORT_EMAIL_SUBJECT);
    assert.equal(query.get('subject'), 'VidoraX Support / Issue Report');
    assert.equal(query.get('body'), buildSupportEmailBody(INFO));
  });

  test('the body is pre-filled with app version, Android version, device and an Issue line', () => {
    const lines = buildSupportEmailBody(INFO).split('\n');
    assert.deepEqual(lines.slice(0, 4), [
      'App version: 2.0.0 (12)',
      'Android version: 15 (API 35)',
      'Device: Google Pixel 8',
      'Issue:',
    ]);
  });
});
