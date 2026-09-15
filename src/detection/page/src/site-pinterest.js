/* global vdx */
// Pinterest videos.video_list (resource API) or videos.videoList (Relay): progressive V_720P-style MP4s and
// V_HLS* playlists, keyed by the numeric pin id of the enclosing pin.
const { isObject, streamKind } = vdx.util;
const { candidate, progressive, hls, urlKey } = vdx.candidates;
const { registerJson, closest } = vdx.extract;

const PIN_ID = /^\d{5,}$/;

function pinIdOf(node) {
  const id = [node.entityId, node.id].map((value) => String(value || '')).find((value) => PIN_ID.test(value));
  return id || '';
}

registerJson({
  matches: (node) => isObject(node.video_list) || isObject(node.videoList),
  extract: (node, entry, context) => {
    const list = isObject(node.video_list) ? node.video_list : node.videoList;
    const videos = Object.keys(list)
      .map((name) => ({ name, video: list[name] }))
      .filter((item) => isObject(item.video) && typeof item.video.url === 'string');
    const sources = videos.map(({ name, video }) => {
      const dimensions = { width: video.width, height: video.height };
      if (/hls/i.test(name) || streamKind(video.url) === 'hls') return hls(video.url, dimensions);
      return streamKind(video.url) === 'progressive' ? progressive(video.url, Object.assign({ mimeType: 'video/mp4' }, dimensions)) : null;
    });
    const first = sources.find(Boolean);
    if (!first) return [];
    const pin = closest(entry, (n) => pinIdOf(n) !== '', 8);
    const pinId = pin ? pinIdOf(pin) : '';
    const images = pin && isObject(pin.images) && isObject(pin.images.orig) ? pin.images.orig.url : undefined;
    const sample = videos[0].video;
    return [
      candidate({
        site: 'pinterest',
        key: pinId ? 'pinterest:' + pinId : urlKey(first.url),
        title: pin ? pin.title || pin.grid_title || pin.description : undefined,
        thumbnailUrl: sample.thumbnail || images,
        durationSec: Number(sample.duration) / 1000,
        contentUrl: pinId ? 'https://www.pinterest.com/pin/' + pinId + '/' : undefined,
        sources,
        provenance: context.provenance,
      }),
    ];
  },
});
