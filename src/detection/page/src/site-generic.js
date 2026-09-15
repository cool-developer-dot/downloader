/* global vdx */
// Site-independent media references: JSON-LD VideoObject, Open Graph og:video, <video>/<source> elements and
// video[data-sources] (LinkedIn). URLs that do not look like media (embed pages, watch pages) are ignored.
const { isObject, streamKind, isoDurationSeconds } = vdx.util;
const { candidate, progressive, hls, dash, urlKey } = vdx.candidates;
const { registerJson, registerDom } = vdx.extract;

const MAX_ELEMENTS = 50;
const MAX_META_TAGS = 400;

function sourceFor(url, mimeType, details) {
  const kind = streamKind(url, mimeType);
  if (kind === 'hls') return hls(url, details);
  if (kind === 'dash') return dash(url);
  if (kind !== 'progressive') return null;
  return progressive(url, Object.assign({ mimeType: /^video\//i.test(String(mimeType)) ? mimeType : undefined }, details));
}

function isVideoObject(type) {
  const types = Array.isArray(type) ? type : [type];
  return types.some((value) => typeof value === 'string' && /(^|\/)VideoObject$/.test(value));
}

function firstImage(value) {
  if (Array.isArray(value)) return firstImage(value[0]);
  return isObject(value) ? value.url || value.contentUrl : value;
}

registerJson({
  matches: (node) => isVideoObject(node['@type']) && (typeof node.contentUrl === 'string' || typeof node.contentURL === 'string'),
  extract: (node, entry, context) => {
    const url = context.resolve(node.contentUrl || node.contentURL);
    const source = url && sourceFor(url, node.encodingFormat, { width: node.width, height: node.height });
    if (!source) return [];
    return [
      candidate({
        site: context.site,
        key: urlKey(url),
        title: node.name || node.headline,
        thumbnailUrl: context.resolve(firstImage(node.thumbnailUrl) || firstImage(node.thumbnail) || firstImage(node.image)),
        durationSec: isoDurationSeconds(node.duration),
        contentUrl: context.resolve(node.url),
        sources: [source],
        provenance: context.provenance,
      }),
    ];
  },
});

/** Candidates for a <video> element's own src and its <source> children (blob: sources are skipped). */
function videoElementCandidates(video, context) {
  const found = [];
  const seen = Object.create(null);
  const poster = context.resolve(video.getAttribute('poster'));
  const add = (rawUrl, mimeType) => {
    const url = context.resolve(rawUrl);
    if (!url || seen[url]) return;
    seen[url] = true;
    const source =
      sourceFor(url, mimeType, { width: video.videoWidth, height: video.videoHeight }) ||
      progressive(url, { width: video.videoWidth, height: video.videoHeight });
    found.push(
      candidate({
        site: context.site,
        key: urlKey(url),
        title: context.title,
        thumbnailUrl: poster,
        durationSec: video.duration,
        sources: [source],
        provenance: 'dom',
      }),
    );
  };
  add(video.currentSrc || video.getAttribute('src'));
  const children = video.getElementsByTagName('source');
  for (let i = 0; i < children.length && i < MAX_ELEMENTS; i++) {
    add(children[i].getAttribute('src'), children[i].getAttribute('type'));
  }
  return found;
}

function dataSourcesCandidate(video, context) {
  let entries;
  try {
    entries = JSON.parse(video.getAttribute('data-sources') || '');
  } catch (_error) {
    return null;
  }
  if (!Array.isArray(entries)) return null;
  const sources = entries
    .filter(isObject)
    .map((entry) => {
      const url = context.resolve(entry.src);
      return url && sourceFor(url, entry.type || 'video/mp4', { bitrate: entry['data-bitrate'] });
    });
  const first = sources.find(Boolean);
  if (!first) return null;
  return candidate({
    site: context.site,
    key: urlKey(first.url),
    title: context.title,
    thumbnailUrl: context.resolve(video.getAttribute('data-poster-url') || video.getAttribute('poster')),
    sources,
    provenance: 'dom',
  });
}

registerDom((doc, context) => {
  const found = [];
  const videos = doc.getElementsByTagName('video');
  for (let i = 0; i < videos.length && i < MAX_ELEMENTS; i++) {
    videoElementCandidates(videos[i], context).forEach((item) => found.push(item));
    if (videos[i].getAttribute('data-sources')) found.push(dataSourcesCandidate(videos[i], context));
  }
  return found;
});

registerDom((doc, context) => {
  const values = Object.create(null);
  const metas = doc.getElementsByTagName('meta');
  for (let i = 0; i < metas.length && i < MAX_META_TAGS; i++) {
    const name = String(metas[i].getAttribute('property') || metas[i].getAttribute('name') || '').toLowerCase();
    if (name.indexOf('og:') === 0 && values[name] === undefined) values[name] = metas[i].getAttribute('content');
  }
  const url = context.resolve(values['og:video:secure_url'] || values['og:video:url'] || values['og:video']);
  const source =
    url && sourceFor(url, values['og:video:type'], { width: values['og:video:width'], height: values['og:video:height'] });
  if (!source) return [];
  return [
    candidate({
      site: context.site,
      key: urlKey(url),
      title: values['og:title'] || context.title,
      thumbnailUrl: context.resolve(values['og:image:secure_url'] || values['og:image']),
      contentUrl: context.resolve(values['og:url']),
      sources: [source],
      provenance: 'dom',
    }),
  ];
});

vdx.generic = { videoElementCandidates };
