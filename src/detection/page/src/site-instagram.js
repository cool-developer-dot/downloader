/* global vdx */
// Instagram (and Threads, which shares its media API). Web API items and xdt_api__v1__media__shortcode__web_info
// carry video_versions (complete MP4s, with audio unless has_audio is false) and an inline video_dash_manifest
// (split tracks). Legacy GraphQL xdt_shortcode_media carries video_url.
const { isObject, cleanText } = vdx.util;
const { candidate, progressive, dash } = vdx.candidates;
const { registerJson, closest } = vdx.extract;

function isThreads(host) {
  return /(^|\.)threads\.(net|com)$/.test(host);
}

function largestImage(media) {
  const images = media.image_versions2 && media.image_versions2.candidates;
  if (!Array.isArray(images)) return media.display_url || media.thumbnail_url;
  return images.filter(isObject).reduce((best, image) => (!best || (image.width || 0) > (best.width || 0) ? image : best), null);
}

function audioFlag(media) {
  return media.has_audio === true || media.has_audio === false ? media.has_audio : undefined;
}

function identity(code, username, index, context) {
  if (isThreads(context.host)) {
    const user = username ? '@' + encodeURIComponent(username) : '@_';
    return { site: 'web', key: 'threads:' + code, contentUrl: 'https://www.threads.com/' + user + '/post/' + code };
  }
  return {
    site: 'instagram',
    key: 'instagram:' + code + (index ? ':' + index : ''),
    contentUrl: index
      ? 'https://www.instagram.com/p/' + code + '/?img_index=' + index
      : 'https://www.instagram.com/reel/' + code + '/',
  };
}

function apiMediaCandidate(media, owner, index, context) {
  if (!Array.isArray(media.video_versions) || !media.video_versions.length) return null;
  const code = typeof owner.code === 'string' ? owner.code : '';
  if (!/^[A-Za-z0-9_-]+$/.test(code)) return null;
  const username = isObject(owner.user) ? owner.user.username : undefined;
  const id = identity(code, username, index, context);
  const hasAudio = audioFlag(media);
  const versions = media.video_versions.filter(isObject).sort((a, b) => (b.width || 0) - (a.width || 0));
  const sources = versions.map((version) =>
    progressive(version.url, { width: version.width, height: version.height, hasAudio, mimeType: 'video/mp4' }),
  );
  sources.push(typeof media.video_dash_manifest === 'string' ? dash(id.contentUrl, media.video_dash_manifest) : null);
  const image = largestImage(media);
  return candidate({
    site: id.site,
    key: id.key,
    title: isObject(owner.caption) ? owner.caption.text : undefined,
    thumbnailUrl: isObject(image) ? image.url : image,
    durationSec: media.video_duration,
    contentUrl: id.contentUrl,
    sources,
    provenance: context.provenance,
  });
}

registerJson({
  matches: (node) =>
    (Array.isArray(node.video_versions) && node.video_versions.length > 0) ||
    (Array.isArray(node.carousel_media) && typeof node.code === 'string'),
  extract: (node, entry, context) => {
    if (Array.isArray(node.carousel_media)) {
      return node.carousel_media
        .map((child, i) => (isObject(child) ? apiMediaCandidate(child, node, i + 1, context) : null))
        .filter(Boolean);
    }
    // A carousel child reached without its parent (e.g. a partial payload) has no code of its own.
    const owner = typeof node.code === 'string' ? node : closest(entry, (n) => typeof n.code === 'string', 3);
    return [owner ? apiMediaCandidate(node, owner, 0, context) : null];
  },
});

registerJson({
  matches: (node) => typeof node.video_url === 'string' && typeof node.shortcode === 'string',
  extract: (node, entry, context) => {
    if (!/^[A-Za-z0-9_-]+$/.test(node.shortcode)) return [];
    const id = identity(node.shortcode, isObject(node.owner) ? node.owner.username : undefined, 0, context);
    const captions = node.edge_media_to_caption && node.edge_media_to_caption.edges;
    const caption = Array.isArray(captions) && isObject(captions[0]) && isObject(captions[0].node) ? captions[0].node.text : undefined;
    const dimensions = isObject(node.dimensions) ? node.dimensions : {};
    return [
      candidate({
        site: id.site,
        key: id.key,
        title: cleanText(caption, 300),
        thumbnailUrl: node.display_url || node.thumbnail_src,
        durationSec: node.video_duration,
        contentUrl: id.contentUrl,
        sources: [
          progressive(node.video_url, {
            width: dimensions.width,
            height: dimensions.height,
            hasAudio: audioFlag(node),
            mimeType: 'video/mp4',
          }),
        ],
        provenance: context.provenance,
      }),
    ];
  },
});
