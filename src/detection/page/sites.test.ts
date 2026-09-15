import assert from 'node:assert/strict';
import { describe, test } from 'node:test';

import type { CandidateSource, PageCandidate } from '../types.ts';
import { fixtureText, loadDetector } from './test-harness.ts';

async function fromResponse(pageUrl: string, apiUrl: string, body: string, contentType = 'application/json') {
  const page = loadDetector({ url: pageUrl, readyState: 'complete' });
  await page.fetch(apiUrl, { contentType, body });
  await page.settle(300);
  return page.candidates();
}

async function fromScript(pageUrl: string, attrs: Record<string, string>, text: string) {
  const page = loadDetector({ url: pageUrl, title: 'Page title', elements: [{ tag: 'script', attrs, text }] });
  await page.domContentLoaded();
  await page.settle(300);
  return page.candidates();
}

function only(candidates: PageCandidate[]): PageCandidate {
  assert.equal(candidates.length, 1, `expected one candidate, got ${JSON.stringify(candidates, null, 1)}`);
  return candidates[0];
}

function progressive(source: CandidateSource | undefined) {
  assert.equal(source?.kind, 'progressive');
  return source as Extract<CandidateSource, { kind: 'progressive' }>;
}

describe('instagram', () => {
  test('web_info item: MP4 versions widest first with has_audio, inline DASH, thumbnail and caption', async () => {
    const [reel] = await fromResponse(
      'https://www.instagram.com/reel/DAbCdEf12_x/',
      'https://www.instagram.com/graphql/query',
      fixtureText('instagram-web-info.json'),
    );
    assert.equal(reel.key, 'instagram:DAbCdEf12_x');
    assert.equal(reel.site, 'instagram');
    assert.equal(reel.title, 'Sunset over the bay \u{1F305}');
    assert.equal(reel.contentUrl, 'https://www.instagram.com/reel/DAbCdEf12_x/');
    assert.equal(reel.durationSec, 14.2);
    assert.match(reel.thumbnailUrl ?? '', /thumb_1080\.jpg/);
    assert.equal(reel.provenance, 'json');

    assert.equal(reel.sources.length, 3, 'the repeated 480p URL is reported once');
    assert.deepEqual(progressive(reel.sources[0]), {
      kind: 'progressive',
      url: 'https://scontent-lhr8-2.cdninstagram.com/o1/v/t16/f2/m86/AQ720.mp4?efg=eyJ2ZW5jb2RlX3RhZyI6InZ0c192b2RfdXJsZ2VuIn0&_nc_ht=scontent-lhr8-2.cdninstagram.com&oh=00_Ab720&oe=68C1B2C3',
      width: 720,
      height: 1280,
      mimeType: 'video/mp4',
      hasAudio: true,
    });
    assert.equal(progressive(reel.sources[1]).width, 480);
    const manifest = reel.sources[2];
    assert.equal(manifest.kind, 'dash');
    assert.equal(manifest.url, 'https://www.instagram.com/reel/DAbCdEf12_x/');
    assert.match(manifest.kind === 'dash' ? (manifest.manifestText ?? '') : '', /^<\?xml[\s\S]*<MPD[\s\S]*mp4a\.40\.5/);
  });

  test('carousel video child: indexed key and post URL, has_audio false kept', async () => {
    const candidates = await fromResponse(
      'https://www.instagram.com/p/DCaRoUsEl01/',
      'https://www.instagram.com/api/v1/media/3456789012345670000/info/',
      fixtureText('instagram-web-info.json'),
    );
    const slide = candidates.find((candidate) => candidate.key.startsWith('instagram:DCaRoUsEl01'));
    assert.equal(slide?.key, 'instagram:DCaRoUsEl01:2');
    assert.equal(slide?.contentUrl, 'https://www.instagram.com/p/DCaRoUsEl01/?img_index=2');
    assert.equal(slide?.title, 'Weekend trip');
    assert.equal(progressive(slide?.sources[0]).hasAudio, false);
  });

  test('legacy xdt_shortcode_media', async () => {
    const body = JSON.stringify({
      data: {
        xdt_shortcode_media: {
          __typename: 'XDTGraphVideo',
          shortcode: 'C9LegacY01',
          is_video: true,
          has_audio: true,
          video_duration: 9.9,
          video_url: 'https://instagram.fxyz1-1.fna.fbcdn.net/o1/v/t16/f1/m82/legacy.mp4?oh=00_L&oe=68C1B2C3',
          display_url: 'https://instagram.fxyz1-1.fna.fbcdn.net/v/t51.2885-15/legacy.jpg',
          dimensions: { width: 1080, height: 1920 },
          edge_media_to_caption: { edges: [{ node: { text: 'Legacy caption' } }] },
          owner: { username: 'someone' },
        },
      },
    });
    const reel = only(await fromResponse('https://www.instagram.com/p/C9LegacY01/', 'https://www.instagram.com/graphql/query', body));
    assert.equal(reel.key, 'instagram:C9LegacY01');
    assert.equal(reel.title, 'Legacy caption');
    assert.deepEqual(progressive(reel.sources[0]), {
      kind: 'progressive',
      url: 'https://instagram.fxyz1-1.fna.fbcdn.net/o1/v/t16/f1/m82/legacy.mp4?oh=00_L&oe=68C1B2C3',
      width: 1080,
      height: 1920,
      mimeType: 'video/mp4',
      hasAudio: true,
    });
  });

  test('the same media shape on Threads gets a Threads identity', async () => {
    const [post] = await fromResponse(
      'https://www.threads.com/@example.creator/post/DAbCdEf12_x',
      'https://www.threads.com/graphql/query',
      fixtureText('instagram-web-info.json'),
    );
    assert.equal(post.key, 'threads:DAbCdEf12_x');
    assert.equal(post.site, 'web');
    assert.equal(post.contentUrl, 'https://www.threads.com/@example.creator/post/DAbCdEf12_x');
  });
});

describe('facebook', () => {
  test('script[data-sjs] Relay payload: HD then SD with audio, inline DASH, id key and story text', async () => {
    const video = only(
      await fromScript(
        'https://www.facebook.com/reel/1122334455667788',
        { type: 'application/json', 'data-sjs': '' },
        fixtureText('facebook-data-sjs.json'),
      ),
    );
    assert.equal(video.key, 'facebook:1122334455667788');
    assert.equal(video.site, 'facebook');
    assert.equal(video.title, 'Morning run by the river');
    assert.equal(video.contentUrl, 'https://www.facebook.com/reel/1122334455667788/');
    assert.equal(video.durationSec, 31.5);
    assert.match(video.thumbnailUrl ?? '', /thumb\.jpg/);
    assert.deepEqual(
      video.sources.map((source) => [source.kind, source.url.replace(/\?.*$/, '')]),
      [
        ['progressive', 'https://video.fxyz1-1.fna.fbcdn.net/o1/v/t2/f2/m69/hd.mp4'],
        ['progressive', 'https://video.fxyz1-1.fna.fbcdn.net/o1/v/t2/f2/m69/sd.mp4'],
        ['dash', 'https://www.facebook.com/reel/1122334455667788/'],
      ],
    );
    assert.equal(progressive(video.sources[0]).height, 1920);
    assert.equal(progressive(video.sources[1]).hasAudio, true);
  });

  test('/api/graphql/ newline-delimited response served as text/html', async () => {
    const node = {
      __typename: 'Video',
      id: '2233445566778899',
      playable_url: 'https://video.fxyz1-1.fna.fbcdn.net/v/t42.1790-2/sd.mp4?_nc_cat=1&oh=00_S&oe=68D0',
      playable_url_quality_hd: 'https://video.fxyz1-1.fna.fbcdn.net/v/t39.25447-2/hd.mp4?_nc_cat=1&oh=00_H&oe=68D0',
      length_in_second: 12,
    };
    const body = `${JSON.stringify({ data: { viewer: {} } })}\r\n${JSON.stringify({ label: 'deferred', data: { video: node } })}\r\n`;
    const video = only(
      await fromResponse('https://www.facebook.com/watch/', 'https://www.facebook.com/api/graphql/', body, 'text/html; charset="utf-8"'),
    );
    assert.equal(video.key, 'facebook:2233445566778899');
    assert.equal(video.contentUrl, 'https://www.facebook.com/watch/?v=2233445566778899');
    assert.match(video.sources[0].url, /hd\.mp4/);
  });
});

describe('tiktok', () => {
  test('rehydration itemStruct: H.264 variants by bitrate, watermarked downloadAddr last, no H.265 or H.266', async () => {
    const item = only(
      await fromScript(
        'https://www.tiktok.com/@example.cook/video/7412345678901234567',
        { id: '__UNIVERSAL_DATA_FOR_REHYDRATION__', type: 'application/json' },
        fixtureText('tiktok-rehydration.json'),
      ),
    );
    assert.equal(item.key, 'tiktok:7412345678901234567');
    assert.equal(item.site, 'tiktok');
    assert.equal(item.title, 'Trying the new recipe #food');
    assert.equal(item.contentUrl, 'https://www.tiktok.com/@example.cook/video/7412345678901234567');
    assert.equal(item.durationSec, 23);
    assert.match(item.thumbnailUrl ?? '', /cover/);
    const [best, playAddr, download] = item.sources.map(progressive);
    assert.equal(item.sources.length, 3, 'playAddr repeats the 540p variant and is reported once');
    assert.deepEqual(
      { ...best, url: best.url.replace(/\?.*$/, '') },
      {
        kind: 'progressive',
        url: 'https://v16-webapp-prime.tiktok.com/video/tos/maliva/tos-maliva-ve-0068/h264_720.mp4',
        width: 720,
        height: 1280,
        bitrate: 1200000,
        sizeBytes: 3400000,
        mimeType: 'video/mp4',
        hasAudio: true,
      },
    );
    assert.match(playAddr.url, /play_h264_540\.mp4/);
    assert.equal(playAddr.watermarked, undefined);
    assert.match(download.url, /download_watermark\.mp4/);
    assert.equal(download.watermarked, true);
  });

  test('feed item_list response; H.265-only items still offer their variants', async () => {
    const body = JSON.stringify({
      itemList: [
        {
          id: '7400000000000000001',
          desc: 'Feed clip',
          author: { uniqueId: 'feed.user' },
          video: {
            duration: 8,
            codecType: 'bytevc1',
            playAddr: 'https://v19-webapp-prime.tiktok.com/video/tos/feed_hevc.mp4?tk=tt_chain_token',
            bitrateInfo: [
              {
                Bitrate: 900000,
                CodecType: 'bytevc1',
                PlayAddr: { Width: 720, Height: 1280, UrlList: ['https://v19-webapp-prime.tiktok.com/video/tos/feed_hevc_720.mp4'] },
              },
            ],
          },
        },
      ],
      hasMore: true,
    });
    const item = only(await fromResponse('https://www.tiktok.com/foryou', 'https://www.tiktok.com/api/recommend/item_list/?aid=1988', body));
    assert.equal(item.key, 'tiktok:7400000000000000001');
    assert.deepEqual(
      item.sources.map((source) => source.url.replace(/\?.*$/, '')),
      ['https://v19-webapp-prime.tiktok.com/video/tos/feed_hevc_720.mp4', 'https://v19-webapp-prime.tiktok.com/video/tos/feed_hevc.mp4'],
    );
  });
});

describe('x / twitter', () => {
  test('TweetDetail: MP4 variants by bitrate with resolution, then HLS; GIFs have no audio', async () => {
    const [video, gif] = await fromResponse(
      'https://x.com/example_news/status/1834567890123456789',
      'https://x.com/i/api/graphql/AbCdEf/TweetDetail?variables=%7B%7D',
      fixtureText('twitter-tweet-detail.json'),
    );
    assert.equal(video.key, 'twitter:1834567890123456789');
    assert.equal(video.site, 'twitter');
    assert.equal(video.title, 'Launch day from the pad');
    assert.equal(video.contentUrl, 'https://x.com/i/status/1834567890123456789');
    assert.equal(video.durationSec, 45.045);
    assert.deepEqual(
      video.sources.map((source) => [source.kind, source.kind === 'progressive' ? `${source.width}x${source.height}` : '']),
      [
        ['progressive', '1920x1080'],
        ['progressive', '1280x720'],
        ['progressive', '480x270'],
        ['hls', ''],
      ],
    );
    assert.equal(progressive(video.sources[0]).bitrate, 10368000);
    assert.equal(progressive(video.sources[0]).hasAudio, true);

    assert.equal(gif.key, 'twitter:1834567890123456789:2');
    assert.equal(progressive(gif.sources[0]).hasAudio, false);
  });
});

describe('reddit', () => {
  test('post JSON: DASH and HLS first, video-only fallback last, &amp; decoded', async () => {
    const post = only(
      await fromResponse(
        'https://www.reddit.com/r/example/comments/1fh2xyz/my_dog_learned_a_new_trick/',
        'https://www.reddit.com/r/example/comments/1fh2xyz/my_dog_learned_a_new_trick/.json',
        fixtureText('reddit-post.json'),
      ),
    );
    assert.equal(post.key, 'reddit:ab12cd34ef56');
    assert.equal(post.title, 'My dog learned a new trick');
    assert.equal(post.contentUrl, 'https://www.reddit.com/r/example/comments/1fh2xyz/my_dog_learned_a_new_trick/');
    assert.equal(post.thumbnailUrl, 'https://external-preview.redd.it/preview.png?format=pjpg&auto=webp&s=abc123');
    assert.deepEqual(post.sources, [
      { kind: 'dash', url: 'https://v.redd.it/ab12cd34ef56/DASHPlaylist.mpd?a=1759999999%2CZmFrZQ%3D%3D&v=1&f=sd' },
      { kind: 'hls', url: 'https://v.redd.it/ab12cd34ef56/HLSPlaylist.m3u8?a=1759999999%2CZmFrZQ%3D%3D&v=1&f=sd', width: 720, height: 1280 },
      {
        kind: 'progressive',
        url: 'https://v.redd.it/ab12cd34ef56/CMAF_720.mp4?source=fallback',
        width: 720,
        height: 1280,
        bitrate: 2400000,
        mimeType: 'video/mp4',
        hasAudio: false,
      },
    ]);
  });

  test('shreddit player element', async () => {
    const page = loadDetector({
      url: 'https://www.reddit.com/r/example/comments/1fh2xyz/my_dog_learned_a_new_trick/',
      elements: [
        {
          tag: 'shreddit-player-2',
          attrs: {
            src: 'https://v.redd.it/ab12cd34ef56/HLSPlaylist.m3u8?a=1759999999&v=1&f=sd',
            poster: 'https://preview.redd.it/ab12cd34ef56.jpeg?format=pjpg',
          },
        },
      ],
    });
    await page.domContentLoaded();
    await page.settle(300);
    const player = only(page.candidates());
    assert.equal(player.key, 'reddit:ab12cd34ef56');
    assert.equal(player.provenance, 'dom');
    assert.equal(player.sources[0].kind, 'hls');
  });
});

describe('vimeo', () => {
  test('inline window.playerConfig: progressive files by height and the default CDN H.264 HLS; no JSON DASH', async () => {
    const video = only(await fromScript('https://player.vimeo.com/video/987654321?h=abc', {}, fixtureText('vimeo-player.html.txt')));
    assert.equal(video.key, 'vimeo:987654321');
    assert.equal(video.site, 'vimeo');
    assert.equal(video.title, 'Aerial coastline in 4K');
    assert.equal(video.durationSec, 95);
    assert.equal(video.contentUrl, 'https://vimeo.com/987654321');
    assert.equal(video.thumbnailUrl, 'https://i.vimeocdn.com/video/1900000000-abc-d');
    assert.deepEqual(
      video.sources.map((source) => [source.kind, source.kind === 'progressive' ? source.height : source.url]),
      [
        ['progressive', 1080],
        ['progressive', 360],
        ['hls', 'https://skyfire.vimeocdn.com/1757100000-0x1/v2/playlist/av/primary/avc/playlist.m3u8?pathsig=7d1'],
      ],
    );
  });
});

describe('twitch', () => {
  test('clip GQL: qualities by height with the playback token appended', async () => {
    const clip = only(await fromResponse('https://clips.twitch.tv/ExampleClipSlug-AbCdEf123', 'https://gql.twitch.tv/gql', fixtureText('twitch-clip-gql.json')));
    assert.equal(clip.key, 'twitch:ExampleClipSlug-AbCdEf123');
    assert.equal(clip.title, 'Unbelievable clutch');
    assert.equal(clip.durationSec, 28);
    assert.equal(clip.contentUrl, 'https://clips.twitch.tv/ExampleClipSlug-AbCdEf123');
    const best = progressive(clip.sources[0]);
    assert.equal(best.height, 1080);
    const url = new URL(best.url);
    assert.equal(url.pathname, '/v2/media/ExampleClipSlug-AbCdEf123/1080.mp4');
    assert.equal(url.searchParams.get('sig'), '0123abcd4567ef89');
    assert.match(url.searchParams.get('token') ?? '', /^\{"authorization"/);
  });

  test('clips without a playback token are not reported', async () => {
    const body = JSON.stringify({ data: { clip: { slug: 'NoToken', videoQualities: [{ quality: '720', sourceURL: 'https://production.assets.clips.twitchcdn.net/x/720.mp4' }] } } });
    assert.deepEqual(await fromResponse('https://clips.twitch.tv/NoToken', 'https://gql.twitch.tv/gql', body), []);
  });
});

describe('pinterest', () => {
  test('PinResource video_list: HLS and 720p MP4 keyed by pin id', async () => {
    const pin = only(
      await fromResponse(
        'https://www.pinterest.com/pin/987654321098765432/',
        'https://www.pinterest.com/resource/PinResource/get/?data=%7B%7D',
        fixtureText('pinterest-pin-resource.json'),
      ),
    );
    assert.equal(pin.key, 'pinterest:987654321098765432');
    assert.equal(pin.title, 'Easy pasta in 10 minutes');
    assert.equal(pin.durationSec, 42);
    assert.equal(pin.contentUrl, 'https://www.pinterest.com/pin/987654321098765432/');
    assert.deepEqual(
      pin.sources.map((source) => [source.kind, source.url]),
      [
        ['hls', 'https://v1.pinimg.com/videos/mc/hls/aa/bb/cc/pasta.m3u8'],
        ['progressive', 'https://v1.pinimg.com/videos/mc/720p/aa/bb/cc/pasta.mp4'],
      ],
    );
  });
});

describe('snapchat', () => {
  test('__NEXT_DATA__ spotlight: video snaps only, with story metadata', async () => {
    const snap = only(
      await fromScript(
        'https://www.snapchat.com/spotlight/W7_EDlXWTBiXAEEniNoMPwAAYaGd0bmx1c2NhAZMabcdAAAAAQ',
        { id: '__NEXT_DATA__', type: 'application/json' },
        fixtureText('snapchat-next-data.json'),
      ),
    );
    assert.equal(snap.key, 'snapchat:W7_EDlXWTBiXAEEniNoMPwAAYaGd0bmx1c2NhAZMabcdAAAAAQ');
    assert.equal(snap.title, 'City lights timelapse');
    assert.equal(snap.durationSec, 12.4);
    assert.match(snap.thumbnailUrl ?? '', /AbCdEf123\.111/);
    assert.deepEqual(snap.sources, [
      {
        kind: 'progressive',
        url: 'https://cf-st.sc-cdn.net/d/AbCdEf123.27.IRZXSOY?mo=GlIaEhoAGgAyAX06AUBQMGABegIIAg%3D%3D&uc=46',
        mimeType: 'video/mp4',
      },
    ]);
  });
});

describe('jw player', () => {
  test('Delivery API playlist: HLS and MP4 sources, audio-only renditions skipped', async () => {
    const item = only(
      await fromResponse('https://www.example-shop.com/tour', 'https://cdn.jwplayer.com/v2/media/AbCd1234', fixtureText('jwplayer-delivery.json')),
    );
    assert.equal(item.key, 'jwplayer:AbCd1234');
    assert.equal(item.site, 'web');
    assert.equal(item.title, 'Product tour');
    assert.equal(item.durationSec, 132);
    assert.deepEqual(item.sources, [
      { kind: 'hls', url: 'https://cdn.jwplayer.com/manifests/AbCd1234.m3u8' },
      {
        kind: 'progressive',
        url: 'https://cdn.jwplayer.com/videos/AbCd1234-Xy12Zw34.mp4',
        width: 1280,
        height: 720,
        bitrate: 1600000,
        mimeType: 'video/mp4',
        sizeBytes: 26400000,
      },
    ]);
  });
});
