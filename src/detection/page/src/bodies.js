/* global vdx */
// Decides which network responses are worth reading and turns their bodies into candidates.
const { whenIdle } = vdx.util;
const { contextFor, extractJson, parseJsonDocuments } = vdx.extract;
const { manifestKind, manifestCandidate } = vdx.manifest;
const { emitCandidates } = vdx.transport;

/** Bytes for streamed fetch bodies, UTF-16 units for XHR text. */
const MAX_BODY_SIZE = 4 * 1024 * 1024;
const MAX_QUEUED_BODIES = 8;

const READABLE_TYPE = /json|mpegurl|dash\+xml/i;
const SKIPPED_TYPE = /^\s*(?:image|audio|video|font)\/|octet-stream|event-stream|protobuf|ump|javascript|ecmascript|text\/css|wasm/i;
const INTERESTING_URL =
  /\/graphql|\/gql(?:[/?#]|$)|\/api\/|item_?list|\/item\/|\/feed|reels_media|tweet-result|\/resource\/|\/metadata\/|\/config(?:[/?#]|$)|\/v2\/media\/|\.json(?:[?#]|$)|\.m3u8(?:[?#]|$)|\.mpd(?:[?#]|$)|^(?:blob|data):/i;

let queuedBodies = 0;

function shouldRead(url, contentType) {
  const type = String(contentType || '');
  if (SKIPPED_TYPE.test(type)) return false;
  return READABLE_TYPE.test(type) || INTERESTING_URL.test(String(url || ''));
}

function inspectText(text, url) {
  const context = contextFor('json', url);
  if (manifestKind(text)) {
    const found = manifestCandidate(text, url, context);
    if (found) emitCandidates([found]);
    return;
  }
  parseJsonDocuments(text).forEach((value) => {
    const found = extractJson(value, context);
    if (found.length) emitCandidates(found);
  });
}

/** Parses a body (string, or an XHR 'json' response object) in idle time, off the page's response handlers. */
function inspectLater(body, url) {
  if (queuedBodies >= MAX_QUEUED_BODIES) return;
  if (typeof body === 'string' && (!body || body.length > MAX_BODY_SIZE)) return;
  queuedBodies += 1;
  whenIdle(() => {
    queuedBodies -= 1;
    try {
      if (typeof body === 'string') inspectText(body, url);
      else emitCandidates(extractJson(body, contextFor('json', url)));
    } catch (_error) {
      // Malformed or hostile bodies are ignored.
    }
  });
}

vdx.bodies = { MAX_BODY_SIZE, shouldRead, inspectLater };
