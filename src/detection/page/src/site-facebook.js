/* global vdx */
// Facebook video nodes from Relay payloads (script[data-sjs], /api/graphql/). browser_native_* and
// progressive_urls are complete MP4s with audio; dash manifests are split video and audio.
const { isObject } = vdx.util;
const { candidate, progressive, hls, dash, urlKey } = vdx.candidates;
const { registerJson, closest } = vdx.extract;

const VIDEO_ID = /^\d{6,}$/;

function textOf(value) {
  if (typeof value === 'string') return value;
  return isObject(value) && typeof value.text === 'string' ? value.text : undefined;
}

function list(value) {
  return Array.isArray(value) ? value.filter(isObject) : [];
}

function videoId(node, entry) {
  const direct = [node.videoId, node.video_id, node.id].map((value) => String(value || '')).find((value) => VIDEO_ID.test(value));
  if (direct) return direct;
  const owner = closest(entry, (n) => n.__typename === 'Video' && VIDEO_ID.test(String(n.id || '')), 4);
  return owner ? String(owner.id) : '';
}

function deliverySources(node, contentUrl) {
  const legacy = isObject(node.videoDeliveryLegacyFields) ? node.videoDeliveryLegacyFields : node;
  const fragment = isObject(node.videoDeliveryResponseFragment) ? node.videoDeliveryResponseFragment : node;
  const result = isObject(fragment.videoDeliveryResponseResult) ? fragment.videoDeliveryResponseResult : fragment;
  const hd = { hasAudio: true, mimeType: 'video/mp4', width: node.width || node.original_width, height: node.height || node.original_height };
  const sd = { hasAudio: true, mimeType: 'video/mp4' };

  const progressiveUrls = list(result.progressive_urls)
    .filter((item) => !item.failure_reason)
    .map((item) => ({ url: item.progressive_url, isHd: isObject(item.metadata) && item.metadata.quality === 'HD' }))
    .sort((a, b) => Number(b.isHd) - Number(a.isHd));

  const sources = progressiveUrls.map((item) => progressive(item.url, item.isHd ? hd : sd));
  sources.push(
    progressive(legacy.browser_native_hd_url || legacy.playable_url_quality_hd, hd),
    progressive(legacy.browser_native_sd_url || legacy.playable_url, sd),
  );
  list(result.dash_manifest_urls).forEach((item) => sources.push(dash(item.manifest_url)));
  list(result.dash_manifests).forEach((item) => sources.push(dash(contentUrl, item.manifest_xml)));
  if (typeof legacy.dash_manifest === 'string') sources.push(dash(contentUrl, legacy.dash_manifest));
  list(result.hls_playlist_urls).forEach((item) => sources.push(hls(item.hls_playlist_url)));
  return sources;
}

registerJson({
  matches: (node) =>
    typeof node.browser_native_hd_url === 'string' ||
    typeof node.browser_native_sd_url === 'string' ||
    typeof node.playable_url === 'string' ||
    typeof node.playable_url_quality_hd === 'string' ||
    isObject(node.videoDeliveryLegacyFields) ||
    isObject(node.videoDeliveryResponseFragment) ||
    Array.isArray(node.progressive_urls),
  extract: (node, entry, context) => {
    const id = videoId(node, entry);
    const permalink = typeof node.permalink_url === 'string' ? node.permalink_url : undefined;
    const contentUrl = permalink || (id ? 'https://www.facebook.com/watch/?v=' + id : context.pageUrl);
    const sources = deliverySources(node, contentUrl);
    const first = sources.find(Boolean);
    if (!first) return [];
    const story = closest(entry, (n) => isObject(n.message) && typeof n.message.text === 'string', 8);
    const thumbnail =
      (isObject(node.preferred_thumbnail) && isObject(node.preferred_thumbnail.image) && node.preferred_thumbnail.image.uri) ||
      (isObject(node.thumbnailImage) && node.thumbnailImage.uri) ||
      node.first_frame_thumbnail;
    const durationMs = Number(node.playable_duration_in_ms);
    return [
      candidate({
        site: 'facebook',
        key: id ? 'facebook:' + id : urlKey(first.url),
        title: textOf(node.title) || textOf(node.savable_description) || (story ? story.message.text : undefined),
        thumbnailUrl: thumbnail,
        durationSec: durationMs > 0 ? durationMs / 1000 : node.length_in_second,
        contentUrl: id || permalink ? contentUrl : undefined,
        sources,
        provenance: context.provenance,
      }),
    ];
  },
});
