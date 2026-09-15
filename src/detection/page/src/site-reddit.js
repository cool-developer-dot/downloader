/* global vdx */
// Reddit. reddit_video objects in post JSON: fallback_url is video-only, so the DASH and HLS manifests (which
// carry the audio) come first. Reddit's API HTML-escapes ampersands in URLs unless raw_json=1 was requested.
// The shreddit web UI renders <shreddit-player-2 src="...HLSPlaylist.m3u8">.
const { isObject, decodeHtmlAmpersands, streamKind } = vdx.util;
const { candidate, progressive, hls, dash, urlKey } = vdx.candidates;
const { registerJson, registerDom, closest } = vdx.extract;

const ASSET = /v\.redd\.it\/([A-Za-z0-9]+)/;
const MAX_PLAYERS = 20;

function assetKey(url) {
  const match = ASSET.exec(String(url || ''));
  return match ? 'reddit:' + match[1] : null;
}

function previewImage(post) {
  const images = isObject(post.preview) && Array.isArray(post.preview.images) ? post.preview.images : [];
  const source = isObject(images[0]) && isObject(images[0].source) ? images[0].source.url : undefined;
  return decodeHtmlAmpersands(source || post.thumbnail);
}

registerJson({
  matches: (node) =>
    typeof node.fallback_url === 'string' && (typeof node.dash_url === 'string' || typeof node.hls_url === 'string'),
  extract: (node, entry, context) => {
    const fallbackUrl = decodeHtmlAmpersands(node.fallback_url);
    const dimensions = { width: node.width, height: node.height };
    const sources = [
      dash(decodeHtmlAmpersands(node.dash_url)),
      hls(decodeHtmlAmpersands(node.hls_url), dimensions),
      progressive(fallbackUrl, {
        width: node.width,
        height: node.height,
        bitrate: Number(node.bitrate_kbps) * 1000,
        hasAudio: false,
        mimeType: 'video/mp4',
      }),
    ];
    const first = sources.find(Boolean);
    if (!first) return [];
    const post = closest(entry, (n) => typeof n.permalink === 'string' && typeof n.title === 'string', 6);
    return [
      candidate({
        site: 'reddit',
        key: assetKey(fallbackUrl) || urlKey(first.url),
        title: post ? post.title : undefined,
        thumbnailUrl: post ? previewImage(post) : undefined,
        durationSec: node.duration,
        contentUrl: post ? 'https://www.reddit.com' + post.permalink : undefined,
        sources,
        provenance: context.provenance,
      }),
    ];
  },
});

registerDom((doc, context) => {
  const found = [];
  ['shreddit-player-2', 'shreddit-player'].forEach((tag) => {
    const players = doc.getElementsByTagName(tag);
    for (let i = 0; i < players.length && i < MAX_PLAYERS; i++) {
      const url = context.resolve(players[i].getAttribute('src'));
      if (!url || streamKind(url) !== 'hls') continue;
      found.push(
        candidate({
          site: 'reddit',
          key: assetKey(url) || urlKey(url),
          title: context.title,
          thumbnailUrl: context.resolve(players[i].getAttribute('poster')),
          contentUrl: /\/comments\//.test(context.pageUrl) ? context.pageUrl : undefined,
          sources: [hls(url)],
          provenance: 'dom',
        }),
      );
    }
  });
  return found;
});
