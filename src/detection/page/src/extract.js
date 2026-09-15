/* global vdx */
// Extractor registry. JSON extractors see every object of a parsed payload; DOM extractors see the document.
// Extractors are pure: they read only their arguments and return PageCandidate[].
const { httpUrl, siteForHost } = vdx.util;

const MAX_WALK_NODES = 250000;
const MAX_WALK_DEPTH = 64;
const MAX_CANDIDATES_PER_PAYLOAD = 200;

const jsonExtractors = [];
const domExtractors = [];

/** extractor: { matches(node): boolean, extract(node, entry, context): PageCandidate[] } */
function registerJson(extractor) {
  jsonExtractors.push(extractor);
}

/** extractor: (document, context) => PageCandidate[] */
function registerDom(extractor) {
  domExtractors.push(extractor);
}

function contextFor(provenance, baseUrl) {
  const pageUrl = String(window.location.href);
  const host = String(window.location.hostname || '').toLowerCase();
  const base = httpUrl(baseUrl) || pageUrl;
  return {
    pageUrl,
    host,
    site: siteForHost(host),
    title: typeof document.title === 'string' ? document.title : '',
    provenance,
    resolve: (value) => httpUrl(value, base),
  };
}

function pushChild(stack, value, parent) {
  if (value !== null && typeof value === 'object' && parent.depth < MAX_WALK_DEPTH) {
    stack.push({ node: value, parent, depth: parent.depth + 1 });
  }
}

function claim(node, entry, context, found) {
  for (let i = 0; i < jsonExtractors.length; i++) {
    const extractor = jsonExtractors[i];
    if (!extractor.matches(node)) continue;
    let candidates = null;
    try {
      candidates = extractor.extract(node, entry, context);
    } catch (_error) {
      // Unknown shapes are expected; keep walking so nested media can still match.
    }
    const usable = (candidates || []).filter(Boolean);
    if (usable.length) {
      for (let j = 0; j < usable.length; j++) found.push(usable[j]);
      return true;
    }
  }
  return false;
}

/**
 * Depth-first walk in document order. A node that yields candidates is not descended into, so a media object
 * is reported once even when it nests its own children (e.g. an Instagram carousel).
 */
function extractJson(root, context) {
  const found = [];
  const stack = [{ node: root, parent: null, depth: 0 }];
  let visited = 0;
  while (stack.length && visited < MAX_WALK_NODES && found.length < MAX_CANDIDATES_PER_PAYLOAD) {
    const entry = stack.pop();
    const node = entry.node;
    visited += 1;
    if (Array.isArray(node)) {
      for (let i = node.length - 1; i >= 0; i--) pushChild(stack, node[i], entry);
    } else if (node !== null && typeof node === 'object' && !claim(node, entry, context, found)) {
      const keys = Object.keys(node);
      for (let i = keys.length - 1; i >= 0; i--) pushChild(stack, node[keys[i]], entry);
    }
  }
  return found;
}

/** Nearest enclosing object (arrays skipped) that satisfies `predicate`, at most `maxLevels` up. */
function closest(entry, predicate, maxLevels) {
  let current = entry.parent;
  for (let level = 0; current && level < maxLevels; level++) {
    const node = current.node;
    if (!Array.isArray(node) && predicate(node)) return node;
    current = current.parent;
  }
  return null;
}

function extractDom(doc, context) {
  const found = [];
  domExtractors.forEach((extractor) => {
    try {
      extractor(doc, context).forEach((item) => {
        if (item) found.push(item);
      });
    } catch (_error) {
      // A broken document shape must not stop the other extractors.
    }
  });
  return found;
}

/** Parsed JSON documents in a response body: plain JSON, Meta's for (;;); prefix, or newline-delimited JSON. */
function parseJsonDocuments(text) {
  let body = text.replace(/^\uFEFF/, '').trim();
  if (body.indexOf('for (;;);') === 0) body = body.slice(9);
  const first = body.charAt(0);
  if (first !== '{' && first !== '[') return [];
  try {
    return [JSON.parse(body)];
  } catch (_error) {
    // Possibly several JSON documents, one per line.
  }
  const documents = [];
  const lines = body.split('\n');
  for (let i = 0; i < lines.length && documents.length < 200; i++) {
    const line = lines[i].trim();
    if (line.charAt(0) !== '{' && line.charAt(0) !== '[') continue;
    try {
      documents.push(JSON.parse(line));
    } catch (_error) {
      // Incomplete chunk.
    }
  }
  return documents;
}

vdx.extract = { registerJson, registerDom, contextFor, extractJson, extractDom, closest, parseJsonDocuments };
