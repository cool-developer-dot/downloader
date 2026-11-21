import assert from 'node:assert/strict';
import { beforeEach, describe, test } from 'node:test';

import type { ProbeRequest, ProbeResult } from '@modules/vidorax-media/src/VidoraMedia.types';

import { observeEngine, onDisguisedProbe, recordProbe, redirectsFor, resetProbeObservationsForTests } from './probe-observations';

const OK = (finalUrl: string, redirects?: number): ProbeResult => ({
  ok: true,
  kind: 'progressive',
  finalUrl,
  contentType: 'video/mp4',
  container: 'mp4',
  sizeBytes: 10,
  resumable: true,
  variants: [],
  audioTracks: [],
  durationMs: null,
  ...(redirects === undefined ? {} : { redirects }),
});

describe('P8 probe observations', () => {
  beforeEach(() => resetProbeObservationsForTests());

  test('the redirect count is kept under the asked and the final URL', () => {
    recordProbe('https://short.example/x', OK('https://cdn.example/v.mp4', 4));
    assert.equal(redirectsFor(['https://short.example/x']), 4);
    assert.equal(redirectsFor(['https://cdn.example/v.mp4']), 4);
    assert.equal(redirectsFor(['https://other.example/']), null);
  });

  test('an older build without the count reads as 0 hops', () => {
    recordProbe('https://cdn.example/v.mp4', OK('https://cdn.example/v.mp4'));
    assert.equal(redirectsFor([null, 'https://cdn.example/v.mp4']), 0);
  });

  test('a disguised refusal is told to the listeners; other failures are not', () => {
    const heard: string[] = [];
    onDisguisedProbe((url, kind) => heard.push(`${kind}:${url}`));
    recordProbe('https://x.example/evil.mp4', { ok: false, reason: 'NOT_MEDIA', httpStatus: null, message: null, disguisedAs: 'apk' });
    recordProbe('https://x.example/page', { ok: false, reason: 'NOT_MEDIA', httpStatus: null, message: null });
    assert.deepEqual(heard, ['apk:https://x.example/evil.mp4']);
  });

  test('observeEngine records probes and leaves every other member as the engine had it', async () => {
    const engine = {
      calls: 0,
      async probe(request: ProbeRequest): Promise<ProbeResult> {
        this.calls += 1;
        return OK(`${request.url}#final`, 3);
      },
      name() {
        return this === engine ? 'bound' : 'unbound';
      },
    };
    const observed = observeEngine(engine);
    assert.equal(observeEngine(engine), observed, 'one wrapper per engine');
    const result = await observed.probe({ url: 'https://a.example/v' } as ProbeRequest);
    assert.equal(result.ok, true);
    assert.equal(engine.calls, 1);
    assert.equal(redirectsFor(['https://a.example/v']), 3);
    assert.equal(observed.name(), 'bound');
  });
});

describe('P8 content kind (JavaScript copy of ContentSniff)', () => {
  test('programs and archives by their first bytes; media is not one', async () => {
    const { contentKindOf } = await import('./content-kind');
    const text = (value: string) => Uint8Array.from(value, (char) => char.charCodeAt(0));
    assert.equal(contentKindOf(text('PK\u0003\u0004\u0014\u0000\u0000\u0000AndroidManifest.xml')), 'apk');
    assert.equal(contentKindOf(text('PK\u0003\u0004\u0014\u0000META-INF/MANIFEST.MF')), 'jar');
    assert.equal(contentKindOf(text('PK\u0003\u0004\u0014\u0000photo.jpg')), 'zip');
    assert.equal(contentKindOf(Uint8Array.from([0x7f, 0x45, 0x4c, 0x46, 2])), 'elf');
    assert.equal(contentKindOf(text('#!/bin/sh\n')), 'script');
    assert.equal(contentKindOf(text('MZ')), 'exe');
    assert.equal(contentKindOf(Uint8Array.from([0x52, 0x61, 0x72, 0x21, 0x1a, 0x07, 0])), 'rar');
    assert.equal(contentKindOf(Uint8Array.from([0, 0, 0, 0x18, 0x66, 0x74, 0x79, 0x70])), null);
    assert.equal(contentKindOf(null), null);
  });

  test('the browser verifier refuses a disguised app and reports it once per link', async () => {
    const { resolveVideoResource } = await import('@/media-detection/resource/video-resource');
    const heard: string[] = [];
    onDisguisedProbe((url, kind) => heard.push(`${kind}:${url}`));
    const bytes = Uint8Array.from('PK\u0003\u0004\u0014\u0000\u0000\u0000AndroidManifest.xml'.padEnd(20000, '\u0000'), (c) => c.charCodeAt(0));
    const resolved = resolveVideoResource({ url: 'https://x.example/holiday.mp4', mimeType: 'video/mp4', bytes });
    assert.equal(resolved.state, 'PROVEN_UNSUPPORTED');
    assert.equal(resolved.reason, 'DISGUISED_PROGRAM');
    assert.deepEqual(heard, ['apk:https://x.example/holiday.mp4']);
  });
});
