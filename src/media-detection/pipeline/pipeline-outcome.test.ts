import assert from 'node:assert/strict';
import test, { beforeEach } from 'node:test';

import {
  clearPipelineOutcomesForTests,
  getPipelineOutcomes,
  isPipelineRejection,
  pipelineOutcomeForDownloadError,
  pipelineRejectionFor,
  recordPipelineOutcome,
} from './pipeline-outcome';

beforeEach(() => {
  clearPipelineOutcomesForTests();
});

test('every stage reason folds into one of the six product outcomes', () => {
  const cases: [string, string][] = [
    ['DRM_UNSUPPORTED', 'PROTECTED'],
    ['PROTECTED_UNSUPPORTED', 'PROTECTED'],
    ['ENCRYPTED_HLS', 'PROTECTED'],
    ['VIDEO_ONLY_UNSUPPORTED', 'UNSUPPORTED'],
    ['SPLIT_AUDIO_VIDEO', 'UNSUPPORTED'],
    ['DASH_UNSUPPORTED', 'UNSUPPORTED'],
    ['LIVE_HLS_UNSUPPORTED', 'LIVE_UNSUPPORTED'],
    ['LIVE_UNSUPPORTED', 'LIVE_UNSUPPORTED'],
    ['TRACK_MISMATCH', 'STALE'],
    ['VIDEO_TRACK_MISSING', 'VIDEO_TRACK_MISSING'],
    ['AUDIO_TRACK_MISSING', 'AUDIO_TRACK_MISSING'],
    ['SEGMENT_FAILED', 'SEGMENT_FAILED'],
    ['MUX_FAILED', 'MUX_FAILED'],
    ['TRANSCODE_FAILED', 'TRANSCODE_FAILED'],
    ['SPLIT_AMBIGUOUS', 'SOURCE_UNRESOLVED'],
    ['MSE_SPLIT_TRACKS_PENDING', 'SOURCE_UNRESOLVED'],
    ['MSE_UNSUPPORTED', 'UNSUPPORTED'],
    ['UNSUPPORTED_FORMAT', 'UNSUPPORTED'],
    ['STALE_PAGE_GENERATION', 'STALE'],
    ['OFFSCREEN_PRELOAD', 'STALE'],
    ['ADVERTISEMENT', 'STALE'],
    ['SOURCE_EXPIRED', 'STALE'],
    ['deferred_expired', 'STALE'],
    ['WEAK_OWNERSHIP', 'SOURCE_UNRESOLVED'],
    ['BLOB_ONLY', 'SOURCE_UNRESOLVED'],
    ['NO_FRESH_SOURCE', 'SOURCE_UNRESOLVED'],
    ['PROBE_FAILED', 'TRANSIENT_FAILURE'],
    ['AUTH_REQUIRED', 'TRANSIENT_FAILURE'],
    ['HTML_RESPONSE', 'INVALID_MEDIA'],
    ['MANIFEST_INVALID', 'INVALID_MEDIA'],
    ['IMAGE_RESOURCE', 'INVALID_MEDIA'],
  ];
  for (const [reason, outcome] of cases) {
    assert.equal(pipelineRejectionFor(reason), outcome, reason);
  }
  // Unknown codes are read by what they name; nothing recognisable is "not proven", never "can't be downloaded".
  assert.equal(pipelineRejectionFor('HLS_SAMPLE_AES_KEY'), 'PROTECTED');
  assert.equal(pipelineRejectionFor('MULTI_PERIOD_UNSUPPORTED'), 'UNSUPPORTED');
  assert.equal(pipelineRejectionFor('WIDEVINE_LICENSE'), 'PROTECTED');
  assert.equal(pipelineRejectionFor('SOMETHING_ELSE'), 'SOURCE_UNRESOLVED');
  assert.equal(pipelineRejectionFor(null), 'SOURCE_UNRESOLVED');
});

test('every engine download failure has its typed outcome', () => {
  const cases: [string, string][] = [
    ['DRM_PROTECTED', 'PROTECTED'],
    ['LIVE_UNSUPPORTED', 'LIVE_UNSUPPORTED'],
    ['SOURCE_EXPIRED', 'SOURCE_UNRESOLVED'],
    ['TRACK_MISMATCH', 'STALE'],
    ['VIDEO_TRACK_MISSING', 'VIDEO_TRACK_MISSING'],
    ['AUDIO_TRACK_MISSING', 'AUDIO_TRACK_MISSING'],
    ['SEGMENT_FAILED', 'SEGMENT_FAILED'],
    ['MUX_FAILED', 'MUX_FAILED'],
    ['TRANSCODE_FAILED', 'TRANSCODE_FAILED'],
    ['INVALID_MEDIA', 'INVALID_MEDIA'],
    ['PROCESSING_FAILED', 'INVALID_MEDIA'],
    ['DUPLICATE', 'DUPLICATE'],
    ['NETWORK', 'TRANSIENT_FAILURE'],
    ['NO_SPACE', 'TRANSIENT_FAILURE'],
  ];
  for (const [code, outcome] of cases) {
    assert.equal(pipelineOutcomeForDownloadError(code), outcome, code);
  }
});

test('entries keep hostnames and hashes only, and a repeated account is recorded once', () => {
  const input = {
    tabId: 't1',
    pageUrl: 'https://videos.example.com/watch?v=42&utm_source=x',
    mediaUrl: 'https://cdn.example.com/v/clip.mp4?sig=SECRET&bytestart=0&byteend=99',
    stage: 'capability' as const,
    outcome: 'REJECTED' as const,
    reason: 'VIDEO_ONLY_UNSUPPORTED',
  };
  const first = recordPipelineOutcome(input);
  recordPipelineOutcome({ ...input, mediaUrl: 'https://cdn.example.com/v/clip.mp4?sig=SECRET&bytestart=100&byteend=199' });
  assert.equal(getPipelineOutcomes('t1').length, 1, 'another byte range of the same file is the same account');
  assert.equal(first.outcome, 'UNSUPPORTED');
  assert.equal(first.mediaHost, 'cdn.example.com');
  assert.ok(!JSON.stringify(first).includes('SECRET'), 'no URL, query or token is kept');

  recordPipelineOutcome({ ...input, outcome: 'OFFERED', reason: null });
  assert.deepEqual(getPipelineOutcomes('t1').map((e) => e.outcome), ['UNSUPPORTED', 'OFFERED']);
  assert.equal(getPipelineOutcomes('other').length, 0);
});

test('a duplicate ends the pipeline without being a rejection', () => {
  const entry = recordPipelineOutcome({
    tabId: 't1',
    pageUrl: 'https://site.example/watch/1',
    mediaUrl: 'https://cdn.example/clip.mp4',
    stage: 'enqueue',
    outcome: 'DUPLICATE',
    reason: 'ALREADY_DOWNLOADED',
  });
  assert.equal(entry.outcome, 'DUPLICATE');
  assert.equal(entry.reason, 'ALREADY_DOWNLOADED');
  assert.equal(isPipelineRejection('DUPLICATE'), false);
  assert.equal(isPipelineRejection('UNSUPPORTED'), true);
});
