import assert from 'node:assert/strict';
import { describe, it } from 'node:test';

import type { EnqueueRequest, ProbeRequest, ProbeResult } from '@modules/vidorax-media/src/VidoraMedia.types';

import { classifyIntakeLink, clipboardOffer, extractLinks } from '@/browser/services/link-intake';
import { linkFromClipboardText } from '@/browser/services/clipboard-link';
import { urlFromSharedText } from '@/browser/services/incoming-link';

import type { V2EnginePort } from './engine-port';
import { ftpRefusalFor, startFtpDownload } from './ftp-download';
import { sameV2Settings, v2DownloadSettings } from './settings';
import {
  batchLinesWithMirrors,
  checkMirrorInput,
  classifyFtpLink,
  ftpLinkTitle,
  ftpLinkWithoutCredentials,
  isFtpLink,
  MAX_MIRRORS,
  multiNetworkForEngine,
  parseFtpLink,
} from './sources';

describe('#304 FTP links', () => {
  it('recognises a link to a file on an FTP server', () => {
    assert.equal(isFtpLink('ftp://files.example.com/pub/clip.mp4'), true);
    assert.equal(isFtpLink('FTPS://files.example.com/clip.mkv'), true);
    assert.equal(isFtpLink('ftp://files.example.com'), false);
    assert.equal(isFtpLink('https://files.example.com/clip.mp4'), false);
  });

  it('parses host, port, path and whether it signs in, and never shows the password', () => {
    const parts = parseFtpLink('ftp://al%40ice:p%3Ass@Files.Example.com:2121/pub/My%20Clip.mp4;type=i');
    assert.deepEqual(parts, { scheme: 'ftp', host: 'files.example.com', port: '2121', path: 'pub/My Clip.mp4', hasCredentials: true });
    assert.equal(parseFtpLink('ftp://host.example/folder/'), null);
    assert.equal(ftpLinkWithoutCredentials('ftp://alice:secret@host.example/v.mp4'), 'ftp://host.example/v.mp4');
    assert.equal(ftpLinkTitle('ftp://alice:secret@host.example/pub/My%20Clip.mp4'), 'My Clip');
  });

  it('refuses private addresses like every other link', () => {
    assert.equal(classifyFtpLink('ftp://192.168.1.20/v.mp4'), 'private');
    assert.equal(classifyFtpLink('ftp://localhost/v.mp4'), 'private');
    assert.equal(classifyFtpLink('ftp://files.example.com/v.mp4'), 'ok');
    assert.equal(classifyIntakeLink('ftp://10.0.0.5/v.mp4'), 'private');
    assert.equal(classifyIntakeLink('ftp://files.example.com/v.mp4'), 'ok');
  });

  it('is found in pasted text, the clipboard and shared text', () => {
    assert.deepEqual(extractLinks('get ftp://files.example.com/a.mp4 and https://x.example/b'), [
      'ftp://files.example.com/a.mp4',
      'https://x.example/b',
    ]);
    assert.equal(linkFromClipboardText('see ftp://files.example.com/a.mp4.'), 'ftp://files.example.com/a.mp4');
    assert.equal(urlFromSharedText('Clip: ftps://files.example.com/a.mkv'), 'ftps://files.example.com/a.mkv');
    assert.equal(clipboardOffer('ftp://files.example.com/a.mp4', null)?.url, 'ftp://files.example.com/a.mp4');
    assert.equal(clipboardOffer('ftp://192.168.0.2/a.mp4', null), null);
  });
});

function engineWith(probe: ProbeResult, enqueued: EnqueueRequest[], probes: ProbeRequest[] = []): V2EnginePort {
  return {
    probe: async (request: ProbeRequest) => {
      probes.push(request);
      return probe;
    },
    enqueueUnique: async (request: EnqueueRequest) => {
      enqueued.push(request);
      return { outcome: 'ENQUEUED', record: { id: 'd1' } as never, libraryItemId: null };
    },
  } as unknown as V2EnginePort;
}

const VIDEO: ProbeResult = {
  ok: true,
  kind: 'ftp',
  finalUrl: 'ftp://files.example.com/pub/clip.mkv',
  contentType: null,
  container: 'mkv',
  sizeBytes: 1234,
  resumable: true,
  variants: [],
  audioTracks: [],
  durationMs: null,
};

describe('#304 starting an FTP download', () => {
  it('probes as ftp and enqueues the file with its title and size', async () => {
    const enqueued: EnqueueRequest[] = [];
    const probes: ProbeRequest[] = [];
    const outcome = await startFtpDownload(engineWith(VIDEO, enqueued, probes), 'ftp://alice:pw@files.example.com/pub/clip.mkv');
    assert.deepEqual(outcome, { kind: 'started', downloadId: 'd1', title: 'clip' });
    assert.equal(probes[0]!.kind, 'ftp');
    assert.equal(enqueued[0]!.kind, 'ftp');
    assert.equal(enqueued[0]!.estimatedBytes, 1234);
    // The engine takes the sign-in out of the link (memory only); JavaScript passes the link as given.
    assert.equal(enqueued[0]!.url, 'ftp://alice:pw@files.example.com/pub/clip.mkv');
  });

  it('never enqueues what the engine refused, and says why', async () => {
    const enqueued: EnqueueRequest[] = [];
    const audio: ProbeResult = { ok: false, reason: 'UNSUPPORTED_FORMAT', httpStatus: null, message: 'Audio only' };
    assert.deepEqual(await startFtpDownload(engineWith(audio, enqueued), 'ftp://files.example.com/a.m4a'), {
      kind: 'refused',
      reason: 'not-video',
    });
    assert.equal(enqueued.length, 0);
    assert.equal(ftpRefusalFor({ ok: false, reason: 'HTTP_403', httpStatus: 401, message: null }), 'sign-in');
    assert.equal(ftpRefusalFor({ ok: false, reason: 'HTTP_404', httpStatus: 404, message: null }), 'not-found');
    assert.equal(
      ftpRefusalFor({ ok: false, reason: 'UNSUPPORTED_FORMAT', httpStatus: null, message: 'FTP downloads need Android 8 or later' }),
      'old-android',
    );
    assert.deepEqual(await startFtpDownload(engineWith(VIDEO, enqueued), 'ftp://192.168.1.2/v.mp4'), { kind: 'refused', reason: 'private' });
    assert.deepEqual(await startFtpDownload(null, 'ftp://files.example.com/v.mp4'), { kind: 'refused', reason: 'unavailable' });
  });
});

describe('#347 mirrors', () => {
  it('accepts a public http(s) link that is not already there, up to the limit', () => {
    assert.deepEqual(checkMirrorInput(' https://mirror.example/v.mp4 ', 'https://cdn.example/v.mp4', []), {
      ok: true,
      url: 'https://mirror.example/v.mp4',
    });
    assert.deepEqual(checkMirrorInput('ftp://mirror.example/v.mp4', null, []), { ok: false, reason: 'invalid' });
    assert.deepEqual(checkMirrorInput('https://192.168.0.4/v.mp4', null, []), { ok: false, reason: 'private' });
    assert.deepEqual(checkMirrorInput('https://cdn.example/v.mp4', 'https://cdn.example/v.mp4', []), { ok: false, reason: 'same' });
    assert.deepEqual(checkMirrorInput('https://m.example/v.mp4', null, ['https://m.example/v.mp4']), {
      ok: false,
      reason: 'duplicate',
    });
    const full = Array.from({ length: MAX_MIRRORS }, (_, i) => `https://m${i}.example/v.mp4`);
    assert.deepEqual(checkMirrorInput('https://new.example/v.mp4', null, full), { ok: false, reason: 'limit' });
  });

  it('reads Batch Add lines: "link | mirror" is one download, other lines are today’s', () => {
    const text = [
      'https://a.example/v.mp4 | https://mirror1.example/v.mp4 | https://mirror2.example/v.mp4',
      'https://b.example/one https://c.example/two',
      'https://a.example/v.mp4',
    ].join('\n');
    assert.deepEqual(batchLinesWithMirrors(text, (line) => extractLinks(line), 50), [
      { url: 'https://a.example/v.mp4', mirrors: ['https://mirror1.example/v.mp4', 'https://mirror2.example/v.mp4'] },
      { url: 'https://b.example/one', mirrors: [] },
      { url: 'https://c.example/two', mirrors: [] },
    ]);
  });
});

describe('#446 Wi-Fi and mobile data together', () => {
  const base = { wifiOnly: false, maxConcurrentDownloads: 2 };

  it('is off by default and never on with Wi-Fi only', () => {
    assert.equal(v2DownloadSettings(base).multiNetwork, false);
    assert.equal(v2DownloadSettings({ ...base, multiNetwork: true }).multiNetwork, true);
    assert.equal(v2DownloadSettings({ ...base, wifiOnly: true, multiNetwork: true }).multiNetwork, false);
    assert.equal(multiNetworkForEngine(true, true), false);
  });

  it('a change of the setting is pushed to the engine', () => {
    assert.equal(sameV2Settings(v2DownloadSettings(base), v2DownloadSettings({ ...base, multiNetwork: true })), false);
  });
});
