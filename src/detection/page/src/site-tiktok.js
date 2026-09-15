/* global vdx */
// TikTok items: webapp.video-detail itemStruct, itemList/item_list API responses, and the app-style aweme
// shape. bitrateInfo lists clean MP4s per codec; downloadAddr is watermarked. H.264 is preferred because it
// plays everywhere, and bytevc2 (H.266) never plays on Android.
const { isObject } = vdx.util;
const { candidate, progressive } = vdx.candidates;
const { registerJson } = vdx.extract;

function isUnplayableCodec(codec) {
  return /bytevc2|h266|vvc/i.test(String(codec || ''));
}

function isH264(codec) {
  return /h264|avc/i.test(String(codec || ''));
}

function firstUrl(urls) {
  return Array.isArray(urls) ? urls.find((url) => typeof url === 'string' && /^https?:/i.test(url)) : undefined;
}

function webSources(video) {
  const variants = (Array.isArray(video.bitrateInfo) ? video.bitrateInfo : [])
    .filter((variant) => isObject(variant) && isObject(variant.PlayAddr) && !isUnplayableCodec(variant.CodecType));
  const h264 = variants.filter((variant) => isH264(variant.CodecType));
  const preferH264 = h264.length > 0 || isH264(video.codecType);
  const sources = (h264.length ? h264 : variants)
    .sort((a, b) => (b.Bitrate || 0) - (a.Bitrate || 0))
    .map((variant) =>
      progressive(firstUrl(variant.PlayAddr.UrlList), {
        width: variant.PlayAddr.Width,
        height: variant.PlayAddr.Height,
        bitrate: variant.Bitrate,
        sizeBytes: variant.PlayAddr.DataSize,
        hasAudio: true,
        mimeType: 'video/mp4',
      }),
    );
  if (!isUnplayableCodec(video.codecType) && (!preferH264 || isH264(video.codecType) || !video.codecType)) {
    sources.push(
      progressive(video.playAddr, { width: video.width, height: video.height, bitrate: video.bitrate, hasAudio: true, mimeType: 'video/mp4' }),
    );
  }
  sources.push(progressive(video.downloadAddr, { hasAudio: true, watermarked: true, mimeType: 'video/mp4' }));
  return sources;
}

function appSources(video) {
  const urlsOf = (address) => (isObject(address) ? firstUrl(address.url_list) : undefined);
  const variants = (Array.isArray(video.bit_rate) ? video.bit_rate : []).filter((variant) => isObject(variant) && !variant.is_bytevc2);
  const h264 = variants.filter((variant) => !variant.is_bytevc1);
  const sources = (h264.length ? h264 : variants)
    .sort((a, b) => (b.bit_rate || 0) - (a.bit_rate || 0))
    .map((variant) =>
      progressive(urlsOf(variant.play_addr), {
        width: variant.play_addr && variant.play_addr.width,
        height: variant.play_addr && variant.play_addr.height,
        bitrate: variant.bit_rate,
        sizeBytes: variant.play_addr && variant.play_addr.data_size,
        hasAudio: true,
        mimeType: 'video/mp4',
      }),
    );
  sources.push(progressive(urlsOf(video.play_addr), { width: video.width, height: video.height, hasAudio: true, mimeType: 'video/mp4' }));
  sources.push(progressive(urlsOf(video.download_addr), { hasAudio: true, watermarked: true, mimeType: 'video/mp4' }));
  return sources;
}

function authorOf(item) {
  if (typeof item.author === 'string') return item.author;
  if (!isObject(item.author)) return undefined;
  return item.author.uniqueId || item.author.unique_id;
}

registerJson({
  matches: (node) =>
    isObject(node.video) &&
    (typeof node.id === 'string' || typeof node.id === 'number' || typeof node.aweme_id === 'string') &&
    (typeof node.video.playAddr === 'string' || Array.isArray(node.video.bitrateInfo) || isObject(node.video.play_addr)),
  extract: (node, entry, context) => {
    const isAppShape = typeof node.aweme_id === 'string';
    const id = String(isAppShape ? node.aweme_id : node.id);
    if (!/^\d+$/.test(id)) return [];
    const video = node.video;
    const author = authorOf(node);
    const cover = isAppShape ? isObject(video.cover) && firstUrl(video.cover.url_list) : video.cover || video.originCover;
    const duration = Number(video.duration);
    return [
      candidate({
        site: 'tiktok',
        key: 'tiktok:' + id,
        title: node.desc,
        thumbnailUrl: cover,
        durationSec: isAppShape ? duration / 1000 : duration,
        contentUrl: author ? 'https://www.tiktok.com/@' + encodeURIComponent(author) + '/video/' + id : undefined,
        sources: isAppShape ? appSources(video) : webSources(video),
        provenance: context.provenance,
      }),
    ];
  },
});
