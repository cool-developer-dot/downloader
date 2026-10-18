import assert from 'node:assert/strict';
import { describe, it } from 'node:test';

import { classifyMediaUrl } from '../direct-analyzer/media-url.ts';
import { buildMediaDetectionInjectedScript } from '../observers/injected-script.ts';
import {
  prefersExternalVideoPlayback,
  resolveVideoFormatHint,
  videoFormatFromMime,
} from '../resource/video-resource.ts';
import {
  resolveCategory,
  resolveContainer,
  resolveExtension,
  resolveMimeType,
} from './extension.parser.ts';

/** What the detection pipeline makes of a candidate URL (+ the type the server declared). */
function detect(url: string, mimeType?: string) {
  const extension = resolveExtension(url, mimeType);
  const container = resolveContainer(extension);
  return {
    extension,
    container,
    category: resolveCategory(container, extension),
    mimeType: resolveMimeType(extension, mimeType),
  };
}

describe('F4V, 3G2 and DivX links are videos', () => {
  it('by file extension', () => {
    // F4V is ISO-BMFF and DivX is AVI: the pipeline names them by the container the engine will prove.
    assert.deepEqual(detect('https://cdn.example/show.f4v'), {
      extension: 'mp4',
      container: 'mp4',
      category: 'video',
      mimeType: 'video/mp4',
    });
    assert.deepEqual(detect('https://cdn.example/movie.DivX?token=1'), {
      extension: 'avi',
      container: 'avi',
      category: 'video',
      mimeType: 'video/x-msvideo',
    });
    assert.deepEqual(detect('https://cdn.example/clip.3g2'), {
      extension: '3g2',
      container: '3g2',
      category: 'video',
      mimeType: 'video/3gpp2',
    });
  });

  it('by the type the server declares, on an extensionless link', () => {
    assert.equal(detect('https://cdn.example/v/1', 'video/x-f4v').category, 'video');
    assert.equal(detect('https://cdn.example/v/1', 'video/x-f4v').container, 'mp4');
    assert.equal(detect('https://cdn.example/v/2', 'video/divx').container, 'avi');
    assert.equal(detect('https://cdn.example/v/3', 'video/3gpp2').container, '3g2');
    assert.equal(videoFormatFromMime('video/x-divx'), 'avi');
    assert.equal(videoFormatFromMime('video/x-f4v; codecs="avc1"'), 'mp4');
  });

  it('a DivX file prefers an external player, like any AVI; an F4V does not', () => {
    assert.equal(prefersExternalVideoPlayback({ fileName: 'movie.divx' }), true);
    assert.equal(prefersExternalVideoPlayback({ mimeType: 'video/divx' }), true);
    assert.equal(prefersExternalVideoPlayback({ fileName: 'show.f4v' }), false);
    assert.equal(resolveVideoFormatHint({ extension: '.F4V' }), 'mp4');
  });

  it('a pasted page names them as progressive video', () => {
    for (const url of ['https://cdn.example/a.f4v', 'https://cdn.example/a.3g2', 'https://cdn.example/a.divx']) {
      assert.deepEqual(classifyMediaUrl(url), { kind: 'progressive', strength: 'strong' }, url);
    }
  });

  it('the in-page observer matches the extensions', () => {
    const script = buildMediaDetectionInjectedScript();
    const pattern = /var EXT_RE = \/(.+)\/i;/.exec(script)?.[1];
    assert.ok(pattern, 'EXT_RE in the observer');
    const extRe = new RegExp(pattern.replace(/\\\\/g, '\\'), 'i');
    for (const url of ['https://cdn.example/a.f4v', 'https://cdn.example/a.3g2?x=1', 'https://cdn.example/a.DIVX#t']) {
      assert.ok(extRe.test(url), url);
    }
    assert.ok(!extRe.test('https://cdn.example/a.f4vx'));
  });
});
