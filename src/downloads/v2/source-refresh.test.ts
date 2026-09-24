/**
 * Phase 11C — the source handed to the engine must still be the live one.
 */
import assert from 'node:assert/strict';
import { describe, test } from 'node:test';

import type { MediaRequestContext } from '@/downloads/types/request-context';
import type { PreDownloadGateResult } from '@/media-detection/services/pre-download-gate.service';

import {
  SOURCE_EXPIRED_MESSAGE,
  SOURCE_TRUSTED_WINDOW_MS,
  resolveFreshSourceForEnqueue,
  type LiveSourceLookup,
} from './source-refresh';
import { PAGE_URL, requestContext } from './test-fixtures';

const PLAIN = 'https://cdn.example.com/media/clip-720p.mp4';
const SIGNED = 'https://v16.tiktokcdn.com/video/tos/abc/def?a=1233&expire=';
const NOW = 1_800_000_000_000;

function signed(expiresInMs: number): string {
  return `${SIGNED}${Math.floor((NOW + expiresInMs) / 1000)}&signature=xyz`;
}

function gateOk(overrides: Partial<Extract<PreDownloadGateResult, { ok: true }>> = {}) {
  return async (input: { sourceUrl: string; requestContext: MediaRequestContext }) =>
    ({
      ok: true,
      finalUrl: input.sourceUrl,
      mimeType: 'video/mp4',
      contentLength: 5_000_000,
      requestContext: input.requestContext,
      transport: 'PROGRESSIVE',
      ...overrides,
    }) as PreDownloadGateResult;
}

function gateFail(reason: string, refreshable = true) {
  return async () =>
    ({
      ok: false,
      reason,
      userMessage: 'The source did not return a valid video.',
      refreshable,
    }) as PreDownloadGateResult;
}

const noLiveSource: LiveSourceLookup = () => null;

describe('pre-enqueue source freshness', () => {
  test('a plain, just-verified source is handed over without a second probe', async () => {
    let probes = 0;
    const result = await resolveFreshSourceForEnqueue(
      { sourceUrl: PLAIN, pageUrl: PAGE_URL, requestContext: requestContext(), verifiedAtMs: NOW - 1_000 },
      {
        lookupLiveSource: noLiveSource,
        gate: async (...args) => {
          probes += 1;
          return gateOk()(args[0]);
        },
        now: () => NOW,
      },
    );
    assert.equal(probes, 0, 'Phase 10: no extra network per download');
    assert.ok(result.ok && result.url === PLAIN && !result.reverified);
  });

  test('a signed source is always re-confirmed, however recently it was verified', async () => {
    let probes = 0;
    const url = signed(10 * 60_000);
    const result = await resolveFreshSourceForEnqueue(
      { sourceUrl: url, pageUrl: PAGE_URL, requestContext: requestContext(), verifiedAtMs: NOW - 500 },
      {
        lookupLiveSource: noLiveSource,
        gate: async (input) => {
          probes += 1;
          return gateOk()(input);
        },
        now: () => NOW,
      },
    );
    assert.equal(probes, 1);
    assert.ok(result.ok && result.reverified);
  });

  test('a stale plain source is re-confirmed after the trusted window', async () => {
    let probes = 0;
    const result = await resolveFreshSourceForEnqueue(
      {
        sourceUrl: PLAIN,
        pageUrl: PAGE_URL,
        requestContext: requestContext(),
        verifiedAtMs: NOW - SOURCE_TRUSTED_WINDOW_MS - 1,
      },
      {
        lookupLiveSource: noLiveSource,
        gate: async (input) => {
          probes += 1;
          return gateOk()(input);
        },
        now: () => NOW,
      },
    );
    assert.equal(probes, 1);
    assert.ok(result.ok);
  });

  test('the live page\'s newer signature replaces the stale one before any probe', async () => {
    const stale = signed(-60_000);
    const fresh = signed(10 * 60_000);
    const gated: string[] = [];
    const result = await resolveFreshSourceForEnqueue(
      { sourceUrl: stale, pageUrl: PAGE_URL, requestContext: requestContext(), verifiedAtMs: NOW - 300_000 },
      {
        lookupLiveSource: ({ previousUrl }) => (previousUrl === stale ? { url: fresh, requestContext: null } : null),
        gate: async (input) => {
          gated.push(input.sourceUrl);
          return gateOk()(input);
        },
        now: () => NOW,
      },
    );
    assert.deepEqual(gated, [fresh], 'the refreshed link is what gets verified');
    assert.ok(result.ok && result.url === fresh && result.refreshed);
  });

  test('a redirect target becomes the enqueued URL', async () => {
    const redirected = 'https://cdn2.example.com/real/clip-720p.mp4';
    const result = await resolveFreshSourceForEnqueue(
      { sourceUrl: PLAIN, pageUrl: PAGE_URL, requestContext: requestContext(), verifiedAtMs: NOW - 60_000 },
      {
        lookupLiveSource: noLiveSource,
        gate: gateOk({ finalUrl: redirected }),
        now: () => NOW,
      },
    );
    assert.ok(result.ok);
    assert.equal(result.ok && result.url, redirected);
    assert.ok(result.ok && result.refreshed);
  });

  test('the session headers survive the refresh', async () => {
    const ctx = requestContext({ referer: PAGE_URL, userAgent: 'UA/1', cookiesRequired: true });
    const result = await resolveFreshSourceForEnqueue(
      { sourceUrl: signed(60_000), pageUrl: PAGE_URL, requestContext: ctx, verifiedAtMs: NOW - 1_000 },
      { lookupLiveSource: noLiveSource, gate: gateOk(), now: () => NOW },
    );
    assert.ok(result.ok);
    assert.equal(result.ok && result.requestContext?.referer, PAGE_URL);
    assert.equal(result.ok && result.requestContext?.userAgent, 'UA/1');
    assert.equal(result.ok && result.requestContext?.cookiesRequired, true);
  });

  test('one refresh-and-retry when the first confirmation fails', async () => {
    const stale = signed(60_000);
    const fresh = signed(20 * 60_000);
    const gated: string[] = [];
    // The page only produces the newer link while the first confirmation is in flight.
    let lookups = 0;
    const result = await resolveFreshSourceForEnqueue(
      { sourceUrl: stale, pageUrl: PAGE_URL, requestContext: requestContext(), verifiedAtMs: NOW - 1_000 },
      {
        lookupLiveSource: () => {
          lookups += 1;
          return lookups === 1 ? null : { url: fresh, requestContext: null };
        },
        gate: async (input) => {
          gated.push(input.sourceUrl);
          return input.sourceUrl === fresh ? gateOk()(input) : gateFail('expired_url')();
        },
        now: () => NOW,
      },
    );
    assert.deepEqual(gated, [stale, fresh], 'exactly one refresh attempt, then verify');
    assert.equal(lookups, 2, 'the page is asked once up front and once after the failure');
    assert.ok(result.ok && result.url === fresh);
  });

  test('an expired link the page can no longer refresh refuses with the actionable message', async () => {
    let probes = 0;
    const result = await resolveFreshSourceForEnqueue(
      { sourceUrl: signed(-60_000), pageUrl: PAGE_URL, requestContext: requestContext(), verifiedAtMs: NOW - 300_000 },
      {
        lookupLiveSource: noLiveSource,
        gate: async () => {
          probes += 1;
          return gateFail('expired_url')();
        },
        now: () => NOW,
      },
    );
    assert.equal(probes, 1, 'never loops the dead link');
    assert.equal(result.ok, false);
    assert.equal(result.ok === false && result.reason, 'SOURCE_EXPIRED');
    assert.equal(result.ok === false && result.message, SOURCE_EXPIRED_MESSAGE);
  });

  test('a source that is simply not media is refused as unverified, not as expired', async () => {
    const result = await resolveFreshSourceForEnqueue(
      { sourceUrl: PLAIN, pageUrl: PAGE_URL, requestContext: requestContext(), verifiedAtMs: NOW - 300_000 },
      {
        lookupLiveSource: noLiveSource,
        gate: gateFail('non_media_mime', false),
        now: () => NOW,
      },
    );
    assert.equal(result.ok, false);
    assert.equal(result.ok === false && result.reason, 'SOURCE_UNVERIFIED');
  });
});
