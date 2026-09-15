/* global vdx */
// Snapchat Spotlight and public stories (__NEXT_DATA__): snapUrls.mediaUrl is a progressive MP4 without a file
// extension. snapMediaType 0 is an image.
const { isObject } = vdx.util;
const { candidate, progressive, urlKey } = vdx.candidates;
const { registerJson, closest } = vdx.extract;

registerJson({
  matches: (node) => isObject(node.snapUrls) && typeof node.snapUrls.mediaUrl === 'string',
  extract: (node, entry, context) => {
    if (node.snapMediaType !== undefined && Number(node.snapMediaType) !== 1) return [];
    const source = progressive(node.snapUrls.mediaUrl, { mimeType: 'video/mp4' });
    if (!source) return [];
    const snapId = isObject(node.snapId) ? node.snapId.value : node.snapId;
    const holder = closest(entry, (n) => isObject(n.metadata) && isObject(n.metadata.videoMetadata), 8);
    const metadata = holder ? holder.metadata.videoMetadata : {};
    const preview = node.snapUrls.mediaPreviewUrl;
    return [
      candidate({
        site: 'snapchat',
        key: typeof snapId === 'string' && /^[A-Za-z0-9_-]+$/.test(snapId) ? 'snapchat:' + snapId : urlKey(source.url),
        title: metadata.name || metadata.description,
        thumbnailUrl: (isObject(preview) ? preview.value : preview) || metadata.thumbnailUrl,
        durationSec: Number(metadata.durationMillis) / 1000,
        sources: [source],
        provenance: context.provenance,
      }),
    ];
  },
});
