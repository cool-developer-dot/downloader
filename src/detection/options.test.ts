import assert from 'node:assert/strict';
import { describe, test } from 'node:test';

import type { ProbeResult, ProbeVariant } from '@modules/vidorax-media/src/VidoraMedia.types';

import {
  downloadTitle,
  finalizeOptions,
  mostSpecificReason,
  optionsFromProbe,
  probeRequestFor,
  unsupportedReason,
  type PageContext,
  type RankedOption,
} from './options.ts';
import type { CandidateSource, DownloadOption, MediaItem } from './types.ts';

const labels = { original: 'Original', noAudio: 'No audio', watermark: 'Watermark' };
const page: PageContext = {
  currentUrl: 'https://www.instagram.com/',
  pageTitle: 'Instagram',
  userAgent: 'UA-page',
  date: new Date(2026, 8, 15),
};

function item(overrides: Partial<MediaItem> = {}): MediaItem {
  return {
    key: 'instagram:C9xYz',
    site: 'instagram',
    title: 'Sunset reel',
    thumbnailUrl: 'https://cdn.example.com/t.jpg',
    durationSec: 32.4,
    contentUrl: 'https://www.instagram.com/reel/C9xYz/',
    sources: [],
    frameUrl: 'https://www.instagram.com/reel/C9xYz/',
    userAgent: 'UA-frame',
    firstSeenAt: 1,
    lastSeenAt: 1,
    availability: { status: 'unresolved' },
    ...overrides,
  };
}

function progressiveProbe(overrides: Partial<Extract<ProbeResult, { ok: true }>> = {}): Extract<ProbeResult, { ok: true }> {
  return {
    ok: true,
    kind: 'progressive',
    finalUrl: 'https://cdn.example.com/final.mp4',
    contentType: 'video/mp4',
    container: 'mp4',
    sizeBytes: 42_000_000,
    resumable: true,
    variants: [],
    audioTracks: [],
    durationMs: 32_000,
    ...overrides,
  };
}

function variant(overrides: Partial<ProbeVariant>): ProbeVariant {
  return {
    id: 'v',
    width: null,
    height: null,
    bitrate: null,
    frameRate: null,
    videoCodec: 'avc1.640028',
    needsAudioMux: false,
    estimatedBytes: null,
    decodable: true,
    ...overrides,
  };
}

function ranked(fields: Partial<DownloadOption> & Partial<Omit<RankedOption, 'option'>>): RankedOption {
  const { audio = 2, watermarked = false, bitrate = 0, ...option } = fields;
  return {
    option: {
      id: option.label ?? 'x',
      label: 'x',
      detail: '',
      height: null,
      estimatedBytes: null,
      needsMux: false,
      request: { url: 'https://a.com/', kind: 'progressive', request: { useCookies: true }, title: 't', site: 'web' },
      ...option,
    },
    audio,
    watermarked,
    bitrate,
  };
}

function only(result: ReturnType<typeof optionsFromProbe>): RankedOption[] {
  assert.ok('ranked' in result, 'expected options');
  return result.ranked;
}

describe('progressive options', () => {
  const source: CandidateSource = { kind: 'progressive', url: 'https://cdn.example.com/v.mp4?oh=1', width: 1080, height: 1920, hasAudio: true, bitrate: 2_000_000 };

  test('labels by resolution and details format and size', () => {
    const [entry] = only(optionsFromProbe(item(), source, progressiveProbe(), page, labels));
    assert.equal(entry.option.label, '1080p');
    assert.equal(entry.option.detail, 'MP4 · 42 MB');
    assert.equal(entry.option.height, 1920);
    assert.equal(entry.option.needsMux, false);
    assert.equal(entry.audio, 2);
  });

  test('builds the enqueue request from item, frame and page', () => {
    const [entry] = only(optionsFromProbe(item(), source, progressiveProbe(), page, labels));
    assert.deepEqual(entry.option.request, {
      url: 'https://cdn.example.com/v.mp4?oh=1',
      kind: 'progressive',
      request: { useCookies: true, userAgent: 'UA-frame', referer: 'https://www.instagram.com/reel/C9xYz/' },
      title: 'Sunset reel',
      site: 'instagram',
      pageUrl: 'https://www.instagram.com/reel/C9xYz/',
      thumbnailUrl: 'https://cdn.example.com/t.jpg',
      durationMs: 32_400,
      qualityLabel: '1080p',
      estimatedBytes: 42_000_000,
    });
  });

  test('split audio/video becomes one option that needs muxing', () => {
    const split: CandidateSource = { kind: 'progressive', url: 'https://v.redd.it/x/DASH_720.mp4', height: 720, audioUrl: 'https://v.redd.it/x/DASH_AUDIO_128.mp4' };
    const [entry] = only(optionsFromProbe(item(), split, progressiveProbe(), page, labels));
    assert.equal(entry.option.needsMux, true);
    assert.equal(entry.option.request.audioUrl, 'https://v.redd.it/x/DASH_AUDIO_128.mp4');
    assert.equal(entry.audio, 2);
  });

  test('unknown resolution, silent and watermarked sources say so', () => {
    const silent: CandidateSource = { kind: 'progressive', url: 'https://a.com/v', hasAudio: false, watermarked: true, mimeType: 'video/webm' };
    const [entry] = only(optionsFromProbe(item(), silent, progressiveProbe({ container: 'unknown', sizeBytes: null }), page, labels));
    assert.equal(entry.option.label, 'Original');
    assert.equal(entry.option.detail, 'WEBM · No audio · Watermark');
    assert.equal(entry.option.request.qualityLabel, undefined);
    assert.equal(entry.audio, 0);
    assert.equal(entry.watermarked, true);
  });

  test('falls back to the page User-Agent and URL when the item has none', () => {
    const [entry] = only(optionsFromProbe(item({ userAgent: '', frameUrl: '', contentUrl: null }), source, progressiveProbe(), page, labels));
    assert.deepEqual(entry.option.request.request, { useCookies: true, userAgent: 'UA-page', referer: 'https://www.instagram.com/' });
    assert.equal(entry.option.request.pageUrl, 'https://www.instagram.com/');
  });
});

describe('manifest options', () => {
  const hls: CandidateSource = { kind: 'hls', url: 'https://cdn.example.com/master.m3u8' };

  test('one option per decodable variant with variant id, estimate and mux flag', () => {
    const result = progressiveProbe({
      kind: 'hls',
      container: 'ts',
      sizeBytes: null,
      variants: [
        variant({ id: 'v1080', width: 1920, height: 1080, bitrate: 5_000_000, estimatedBytes: 120_000_000, needsAudioMux: true }),
        variant({ id: 'hevc', width: 3840, height: 2160, videoCodec: 'hvc1', decodable: false }),
        variant({ id: 'v360', width: 640, height: 360, bitrate: 800_000 }),
        variant({ id: 'audio-ish', bitrate: 128_000 }),
      ],
      audioTracks: [{ id: 'a', language: 'en', label: null, bitrate: null, codec: 'mp4a.40.2', isDefault: true }],
    });
    const entries = only(optionsFromProbe(item({ durationSec: null }), hls, result, page, labels));
    assert.deepEqual(
      entries.map(({ option }) => [option.label, option.detail, option.needsMux, option.request.variant?.videoId]),
      [
        ['1080p', 'MP4 · 120 MB', true, 'v1080'],
        ['360p', 'MP4', false, 'v360'],
        ['128 kbps', 'MP4', false, 'audio-ish'],
      ],
    );
    assert.equal(entries[0].option.request.kind, 'hls');
    assert.equal(entries[0].option.request.durationMs, 32_000, 'probed duration when the page gave none');
    assert.equal(entries[1].audio, 2);
  });

  test('no decodable variant is an unsupported format', () => {
    const result = progressiveProbe({ kind: 'dash', variants: [variant({ decodable: false })] });
    assert.deepEqual(optionsFromProbe(item(), hls, result, page, labels), { reason: 'UNSUPPORTED_FORMAT' });
  });

  test('a manifest without variants is one option; inline DASH keeps its manifest text', () => {
    const inline: CandidateSource = { kind: 'dash', url: 'https://www.instagram.com/reel/C9xYz/', manifestText: '<MPD/>' };
    const [entry] = only(optionsFromProbe(item(), inline, progressiveProbe({ kind: 'dash', variants: [] }), page, labels));
    assert.equal(entry.option.label, 'Original');
    assert.equal(entry.option.request.manifestText, '<MPD/>');
    assert.deepEqual(probeRequestFor(item(), inline, page).kind, 'dash');
    assert.equal(probeRequestFor(item(), hls, page).kind, undefined, 'native sniffs URL sources');
  });
});

describe('finalizeOptions', () => {
  test('drops silent options when any has audio, prefers clean, dedupes by label, best first', () => {
    const options = finalizeOptions([
      ranked({ label: '1080p', height: 1080, audio: 0 }),
      ranked({ label: '720p', height: 720, watermarked: true, bitrate: 9 }),
      ranked({ label: '720p', height: 720, bitrate: 1, detail: 'clean' }),
      ranked({ label: '480p', height: 480, needsMux: true }),
      ranked({ label: '480p', height: 480, detail: 'no mux' }),
      ranked({ label: '1440p', height: 1440, watermarked: true }),
    ]);
    assert.deepEqual(
      options.map((option) => `${option.label}${option.detail ? ` ${option.detail}` : ''}`),
      ['720p clean', '480p no mux', '1440p'],
    );
  });

  test('keeps silent options when nothing has audio, and unknown resolutions apart by detail', () => {
    const options = finalizeOptions([
      ranked({ label: 'Original', detail: 'MP4 · 5 MB', audio: 0, bitrate: 1 }),
      ranked({ label: 'Original', detail: 'MP4 · 9 MB', audio: 0, bitrate: 2 }),
      ranked({ label: 'Original', detail: 'MP4 · 9 MB', audio: 0 }),
    ]);
    assert.deepEqual(options.map((option) => option.detail), ['MP4 · 9 MB', 'MP4 · 5 MB']);
  });
});

describe('titles and reasons', () => {
  test('title falls back to the page title, then host and date', () => {
    assert.equal(downloadTitle(item({ title: '' }), page), 'Instagram');
    assert.equal(downloadTitle(item({ title: '', contentUrl: 'https://www.example.com/v/1' }), { ...page, pageTitle: null }), 'example.com 2026-09-15');
  });

  test('maps probe failures and picks the most specific reason', () => {
    assert.equal(unsupportedReason('HTTP_403'), 'SOURCE_UNAVAILABLE');
    assert.equal(unsupportedReason('NETWORK'), 'SOURCE_UNAVAILABLE');
    assert.equal(unsupportedReason('DRM_PROTECTED'), 'DRM_PROTECTED');
    assert.equal(mostSpecificReason(['SOURCE_UNAVAILABLE', 'NOT_MEDIA', 'DRM_PROTECTED']), 'DRM_PROTECTED');
    assert.equal(mostSpecificReason([]), 'SOURCE_UNAVAILABLE');
  });
});
