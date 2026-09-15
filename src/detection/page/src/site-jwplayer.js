/* global vdx */
// JW Player playlist items (Delivery API cdn.jwplayer.com/v2/media/<id> and inline playlists).
const { isObject, streamKind } = vdx.util;
const { candidate, progressive, hls, dash } = vdx.candidates;
const { registerJson } = vdx.extract;

function sourceFor(item, context) {
  const type = String(item.type || '').toLowerCase();
  if (type.indexOf('audio/') === 0) return null;
  const url = context.resolve(item.file);
  const kind = url && (type === 'hls' ? 'hls' : streamKind(url, type));
  if (kind === 'hls') return hls(url, { width: item.width, height: item.height, bitrate: item.bitrate });
  if (kind === 'dash') return dash(url);
  if (kind !== 'progressive') return null;
  return progressive(url, {
    width: item.width,
    height: item.height,
    bitrate: item.bitrate,
    sizeBytes: item.filesize,
    mimeType: type.indexOf('video/') === 0 ? type : undefined,
  });
}

registerJson({
  matches: (node) => typeof node.mediaid === 'string' && Array.isArray(node.sources),
  extract: (node, entry, context) => [
    candidate({
      site: context.site,
      key: 'jwplayer:' + node.mediaid,
      title: node.title,
      thumbnailUrl: context.resolve(node.image),
      durationSec: node.duration,
      contentUrl: context.resolve(node.link),
      sources: node.sources.filter(isObject).map((item) => sourceFor(item, context)),
      provenance: context.provenance,
    }),
  ],
});
