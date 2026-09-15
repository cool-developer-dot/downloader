/* global vdx */
// Builders for PageCandidate and CandidateSource (src/detection/types.ts). They drop anything that is not an
// absolute http(s) URL, so extractors can pass raw values straight from page data.
const { httpUrl, positiveInt, positiveNumber, cleanText, hashString, utf8Length } = vdx.util;

const MAX_TITLE_LENGTH = 300;
const MAX_KEY_LENGTH = 512;
const MAX_MANIFEST_BYTES = 150000;

function setInt(target, name, value) {
  const number = positiveInt(value);
  if (number !== undefined) target[name] = number;
}

function progressive(url, details) {
  const href = httpUrl(url);
  if (!href) return null;
  const options = details || {};
  const source = { kind: 'progressive', url: href };
  setInt(source, 'width', options.width);
  setInt(source, 'height', options.height);
  setInt(source, 'bitrate', options.bitrate);
  if (typeof options.mimeType === 'string' && options.mimeType) source.mimeType = options.mimeType.slice(0, 100);
  if (options.hasAudio === true || options.hasAudio === false) source.hasAudio = options.hasAudio;
  if (options.watermarked === true) source.watermarked = true;
  setInt(source, 'sizeBytes', options.sizeBytes);
  const audioUrl = httpUrl(options.audioUrl);
  if (audioUrl) source.audioUrl = audioUrl;
  return source;
}

function hls(url, details) {
  const href = httpUrl(url);
  if (!href) return null;
  const options = details || {};
  const source = { kind: 'hls', url: href };
  setInt(source, 'width', options.width);
  setInt(source, 'height', options.height);
  setInt(source, 'bitrate', options.bitrate);
  return source;
}

/**
 * DASH by URL, or an inline MPD: then `url` is the document that relative BaseURLs resolve against and the
 * manifest travels as `manifestText`.
 */
function dash(url, manifestText) {
  const href = httpUrl(url);
  if (!href) return null;
  if (manifestText === undefined) return { kind: 'dash', url: href };
  if (typeof manifestText !== 'string' || manifestText.indexOf('<MPD') < 0) return null;
  if (utf8Length(manifestText) > MAX_MANIFEST_BYTES) return null;
  return { kind: 'dash', url: href, manifestText };
}

function sourceIdentity(source) {
  return source.kind + ' ' + source.url + (source.manifestText ? ' ' + hashString(source.manifestText) : '');
}

/** PageCandidate, or null when no usable source remains. */
function candidate(fields) {
  const sources = [];
  const seen = Object.create(null);
  (fields.sources || []).forEach((source) => {
    if (!source || seen[sourceIdentity(source)]) return;
    seen[sourceIdentity(source)] = true;
    sources.push(source);
  });
  if (!sources.length || typeof fields.key !== 'string' || !fields.key) return null;

  const result = { key: fields.key.slice(0, MAX_KEY_LENGTH), site: fields.site || 'web' };
  const title = cleanText(fields.title, MAX_TITLE_LENGTH);
  if (title) result.title = title;
  const thumbnailUrl = httpUrl(fields.thumbnailUrl);
  if (thumbnailUrl) result.thumbnailUrl = thumbnailUrl;
  const durationSec = positiveNumber(fields.durationSec);
  if (durationSec !== undefined) result.durationSec = Math.round(durationSec * 1000) / 1000;
  const contentUrl = httpUrl(fields.contentUrl);
  if (contentUrl) result.contentUrl = contentUrl;
  result.sources = sources;
  result.provenance = fields.provenance;
  return result;
}

/** Key for media without a known asset id. */
function urlKey(url) {
  return 'url:' + url;
}

vdx.candidates = { progressive, hls, dash, candidate, urlKey };
