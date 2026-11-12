import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { describe, it } from 'node:test';

import type { DownloadQualityOption } from '@/api/types';
import { sniffMediaSignature } from '@/downloads/engine/media-signature';
import { buildV2EnqueueRequest } from '@/downloads/v2/enqueue-request';
import { libraryFormatLabel } from '@/library/format-label';

import { classifyMediaUrl } from '../direct-analyzer/media-url.ts';
import { buildMediaDetectionInjectedScript } from '../observers/injected-script.ts';
import { resolveVideoResource, videoFormatFromMime } from '../resource/video-resource.ts';
import { resolveCategory, resolveContainer, resolveExtension, resolveMimeType } from './extension.parser.ts';

/** The native module's own fixtures (ffmpeg `-f mpeg` / `-f vob`; the scrambled one has PES_scrambling_control = 01). */
function fixture(name: string): Uint8Array {
  const path = new URL(`../../../modules/vidorax-media/android/src/test/resources/media/process/${name}`, import.meta.url);
  return new Uint8Array(readFileSync(path)).subarray(0, 16 * 1024);
}

function detect(url: string, mimeType?: string) {
  const extension = resolveExtension(url, mimeType);
  const container = resolveContainer(extension);
  return { extension, container, category: resolveCategory(container, extension), mimeType: resolveMimeType(extension, mimeType) };
}

describe('MPEG program streams: .mpg, .mpeg, .vob (F4)', () => {
  it('are videos by file extension, named mpg / video/mpeg', () => {
    for (const url of ['https://archive.example/films/a.mpg', 'https://cdn.example/Clip.MPEG?x=1', 'https://dvd.example/VIDEO_TS/VTS_01_1.VOB']) {
      assert.deepEqual(detect(url), { extension: 'mpg', container: 'mpg', category: 'video', mimeType: 'video/mpeg' }, url);
    }
  });

  it('are videos by the type the server declares', () => {
    for (const type of ['video/mpeg', 'video/dvd', 'video/mpg', 'video/x-mpeg', 'video/mp2p']) {
      assert.equal(videoFormatFromMime(type), 'mpg', type);
      assert.equal(detect('https://cdn.example/v/1', type).container, 'mpg', type);
    }
  });

  it('a pasted link and the in-page observer know the extensions', () => {
    for (const url of ['https://cdn.example/a.mpg', 'https://cdn.example/a.mpeg', 'https://cdn.example/a.vob']) {
      assert.deepEqual(classifyMediaUrl(url), { kind: 'progressive', strength: 'strong' }, url);
    }
    const pattern = /var EXT_RE = \/(.+)\/i;/.exec(buildMediaDetectionInjectedScript())?.[1];
    assert.ok(pattern);
    const extRe = new RegExp(pattern.replace(/\\\\/g, '\\'), 'i');
    assert.ok(extRe.test('https://dvd.example/VTS_01_1.VOB?t=1'));
    assert.ok(!extRe.test('https://dvd.example/VTS_01_1.vobx'));
  });

  it('are proven by their pack header, MPEG-1 and MPEG-2 alike; scrambled DVD titles are protected', () => {
    assert.deepEqual(sniffMediaSignature(fixture('ps-mpeg1.mpg')), { ok: true, kind: 'mpg', reason: null });
    assert.deepEqual(sniffMediaSignature(fixture('ps-dvd.vob')), { ok: true, kind: 'mpg', reason: null });
    assert.deepEqual(sniffMediaSignature(fixture('ps-scrambled.vob')), { ok: false, kind: 'mpg', reason: 'drm_protected' });

    const verified = resolveVideoResource({ url: 'https://dvd.example/VTS_01_1.VOB', mimeType: 'video/dvd', bytes: fixture('ps-dvd.vob') });
    assert.equal(verified.state, 'VERIFIED');
    assert.equal(verified.format, 'mpg');
    assert.equal(verified.mimeType, 'video/mpeg');
    const scrambled = resolveVideoResource({ url: 'https://dvd.example/VTS_01_1.VOB', bytes: fixture('ps-scrambled.vob') });
    assert.equal(scrambled.state, 'PROVEN_UNSUPPORTED');
    assert.equal(scrambled.reason, 'drm_protected');
  });

  it('a verified .mpg is handed to the engine as a progressive download, and labelled MPG', () => {
    const option = {
      id: 'mpg',
      sourceUrl: 'https://archive.example/films/a.mpg',
      container: 'mpg',
      mimeType: 'video/mpeg',
      streamType: 'PROGRESSIVE',
      isProgressive: true,
      downloadable: true,
      label: 'Original',
    } as unknown as DownloadQualityOption;
    const decision = buildV2EnqueueRequest({ option, title: 'Film', pageUrl: 'https://archive.example/details/film', thumbnailUrl: null, requestContext: null });
    assert.equal(decision.ok, true);
    assert.equal(decision.ok ? decision.request.kind : null, 'progressive');
    assert.equal(libraryFormatLabel('video/mpeg'), 'MPG');
  });
});
