/* global vdx */
// Twitch clips from GQL responses (VideoAccessToken_Clip and clip pages). sourceURL only plays with the
// playbackAccessToken signature and token appended; without them the CDN answers 401, so nothing is reported.
// VODs and live streams are HLS that the network observer sees.
const { isObject } = vdx.util;
const { candidate, progressive } = vdx.candidates;
const { registerJson, closest } = vdx.extract;

function isToken(value) {
  return isObject(value) && typeof value.signature === 'string' && typeof value.value === 'string';
}

registerJson({
  matches: (node) => Array.isArray(node.videoQualities) && node.videoQualities.length > 0,
  extract: (node, entry, context) => {
    const clip = typeof node.slug === 'string' ? node : closest(entry, (n) => typeof n.slug === 'string', 4);
    if (!clip || !/^[A-Za-z0-9_-]+$/.test(clip.slug)) return [];
    const token = isToken(node.playbackAccessToken) ? node.playbackAccessToken : clip.playbackAccessToken;
    if (!isToken(token)) return [];
    const query = 'sig=' + encodeURIComponent(token.signature) + '&token=' + encodeURIComponent(token.value);
    const sources = node.videoQualities
      .filter((quality) => isObject(quality) && typeof quality.sourceURL === 'string')
      .sort((a, b) => Number(b.quality) - Number(a.quality))
      .map((quality) =>
        progressive(quality.sourceURL + (quality.sourceURL.indexOf('?') >= 0 ? '&' : '?') + query, {
          height: quality.quality,
          hasAudio: true,
          mimeType: 'video/mp4',
        }),
      );
    return [
      candidate({
        site: 'twitch',
        key: 'twitch:' + clip.slug,
        title: clip.title,
        thumbnailUrl: clip.thumbnailURL,
        durationSec: clip.durationSeconds,
        contentUrl: 'https://clips.twitch.tv/' + clip.slug,
        sources,
        provenance: context.provenance,
      }),
    ];
  },
});
