/* global vdx */
// Vimeo player config (player.vimeo.com window.playerConfig or its /config response). request.files.dash
// points at Vimeo's JSON segment playlist rather than an MPD, so only progressive files and HLS are used.
const { isObject } = vdx.util;
const { candidate, progressive, hls } = vdx.candidates;
const { registerJson } = vdx.extract;

/** URL from the default CDN first; avc_url is the H.264-only variant of the same stream. */
function cdnUrl(stream) {
  if (!isObject(stream) || !isObject(stream.cdns)) return undefined;
  const names = Object.keys(stream.cdns).sort(
    (a, b) => Number(b === stream.default_cdn) - Number(a === stream.default_cdn),
  );
  for (const name of names) {
    const cdn = stream.cdns[name];
    if (isObject(cdn) && (cdn.avc_url || cdn.url)) return cdn.avc_url || cdn.url;
  }
  return undefined;
}

registerJson({
  matches: (node) => isObject(node.request) && isObject(node.request.files) && isObject(node.video),
  extract: (node, entry, context) => {
    const video = node.video;
    const id = String(video.id || '');
    if (!/^\d+$/.test(id)) return [];
    const files = node.request.files;
    const sources = (Array.isArray(files.progressive) ? files.progressive : [])
      .filter(isObject)
      .sort((a, b) => (b.height || 0) - (a.height || 0))
      .map((file) =>
        progressive(file.url, { width: file.width, height: file.height, hasAudio: true, mimeType: file.mime || 'video/mp4' }),
      );
    sources.push(hls(cdnUrl(files.hls)));
    const thumbs = isObject(video.thumbs) ? video.thumbs : {};
    return [
      candidate({
        site: 'vimeo',
        key: 'vimeo:' + id,
        title: video.title,
        thumbnailUrl: thumbs.base || thumbs['1280'] || thumbs['960'] || thumbs['640'],
        durationSec: video.duration,
        contentUrl: video.url || video.share_url || 'https://vimeo.com/' + id,
        sources,
        provenance: context.provenance,
      }),
    ];
  },
});
