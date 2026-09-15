/* global vdx */
// X / Twitter media entities (GraphQL TweetDetail, timelines, tweet-result). video/mp4 variants are complete
// files with audio (animated GIFs have none); the HLS master splits audio into separate renditions.
const { isObject } = vdx.util;
const { candidate, progressive, hls } = vdx.candidates;
const { registerJson, closest } = vdx.extract;

const STATUS_PATH = /\/status(?:es)?\/(\d+)(?:\/(?:video|photo)\/(\d+))?/;
const RESOLUTION_PATH = /\/(\d{2,5})x(\d{2,5})\//;

registerJson({
  matches: (node) => isObject(node.video_info) && Array.isArray(node.video_info.variants),
  extract: (node, entry, context) => {
    const tweet = closest(entry, (n) => typeof n.full_text === 'string' || typeof n.rest_id === 'string', 6);
    const status = STATUS_PATH.exec(String(node.expanded_url || ''));
    const tweetId = status ? status[1] : String((tweet && (tweet.id_str || tweet.rest_id)) || '');
    if (!/^\d+$/.test(tweetId)) return [];
    const position = status && status[2] && status[2] !== '1' ? ':' + status[2] : '';
    const hasAudio = node.type !== 'animated_gif';
    const variants = node.video_info.variants.filter((variant) => isObject(variant) && typeof variant.url === 'string');
    const sources = variants
      .filter((variant) => /mp4/i.test(String(variant.content_type)))
      .sort((a, b) => (b.bitrate || 0) - (a.bitrate || 0))
      .map((variant) => {
        const size = RESOLUTION_PATH.exec(variant.url) || [];
        return progressive(variant.url, { width: size[1], height: size[2], bitrate: variant.bitrate, hasAudio, mimeType: 'video/mp4' });
      });
    variants
      .filter((variant) => /mpegurl/i.test(String(variant.content_type)))
      .forEach((variant) => sources.push(hls(variant.url)));
    const text = tweet && typeof tweet.full_text === 'string' ? tweet.full_text : undefined;
    return [
      candidate({
        site: 'twitter',
        key: 'twitter:' + tweetId + position,
        title: text ? text.replace(/\s*https:\/\/t\.co\/\w+\s*$/, '') : undefined,
        thumbnailUrl: node.media_url_https,
        durationSec: Number(node.video_info.duration_millis) / 1000,
        contentUrl: 'https://x.com/i/status/' + tweetId,
        sources,
        provenance: context.provenance,
      }),
    ];
  },
});
