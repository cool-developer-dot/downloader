/* global vdx */
// HLS and DASH manifests recognised by their first bytes, whatever URL or content type served them.
const { httpUrl, hashString } = vdx.util;
const { candidate, hls, dash, urlKey } = vdx.candidates;

const MAX_REMEMBERED_RENDITIONS = 500;

// Media playlists referenced by a master playlist already reported; they are renditions, not separate videos.
let renditionUrls = Object.create(null);
let renditionCount = 0;

function manifestKind(text) {
  const head = text.slice(0, 2048).replace(/^[\uFEFF\s]+/, '');
  if (head.indexOf('#EXTM3U') === 0) return 'hls';
  return head.charAt(0) === '<' && /<MPD[\s>]/.test(head) ? 'dash' : null;
}

function rememberRenditions(playlist, masterUrl) {
  playlist.split('\n').forEach((line) => {
    const trimmed = line.trim();
    const uri = trimmed.charAt(0) === '#' ? (/URI="([^"]+)"/.exec(trimmed) || [])[1] : trimmed;
    const url = uri ? httpUrl(uri, masterUrl) : null;
    if (!url || renditionUrls[url]) return;
    if (renditionCount >= MAX_REMEMBERED_RENDITIONS) {
      renditionUrls = Object.create(null);
      renditionCount = 0;
    }
    renditionUrls[url] = true;
    renditionCount += 1;
  });
}

/** Candidate for a manifest body served from `url`, or null when there is nothing new to report. */
function manifestCandidate(text, url, context) {
  const kind = manifestKind(text);
  const href = httpUrl(url);
  if (kind === 'hls') {
    // An HLS playlist behind a blob: URL cannot be fetched again outside the page.
    if (!href) return null;
    if (text.indexOf('#EXT-X-STREAM-INF') >= 0) rememberRenditions(text, href);
    else if (renditionUrls[href]) return null;
    return candidate({ site: context.site, key: urlKey(href), title: context.title, sources: [hls(href)], provenance: 'manifest-body' });
  }
  if (kind !== 'dash') return null;
  if (href) {
    return candidate({ site: context.site, key: urlKey(href), title: context.title, sources: [dash(href)], provenance: 'manifest-body' });
  }
  // A blob: or data: MPD built by the page travels as text; relative BaseURLs resolve against the document.
  return candidate({
    site: context.site,
    key: urlKey(context.pageUrl) + '#mpd-' + hashString(text),
    title: context.title,
    sources: [dash(context.pageUrl, text)],
    provenance: 'manifest-body',
  });
}

vdx.manifest = { manifestKind, manifestCandidate };
