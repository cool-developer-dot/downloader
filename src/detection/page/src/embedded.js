/* global vdx */
// Page data already in the document: JSON scripts (__UNIVERSAL_DATA_FOR_REHYDRATION__, __NEXT_DATA__,
// script[data-sjs], JSON-LD and other application/json), Vimeo's inline playerConfig, Meta video URLs inside
// inline scripts, and the DOM extractors. Scans on DOMContentLoaded, on load and after SPA navigation.
const { setTimer, clearTimer, guard } = vdx.util;
const { contextFor, extractJson, extractDom } = vdx.extract;
const { candidate, progressive, urlKey } = vdx.candidates;
const { emitCandidates } = vdx.transport;

const PAGE_DATA_IDS = ['__UNIVERSAL_DATA_FOR_REHYDRATION__', '__NEXT_DATA__', '__PWS_INITIAL_PROPS__', '__PWS_DATA__'];
const MAX_PAGE_DATA_CHARS = 8 * 1024 * 1024;
const MAX_JSON_SCRIPT_CHARS = 2 * 1024 * 1024;
const MAX_INLINE_SCRIPT_CHARS = 1024 * 1024;
const MAX_CHARS_PER_SCAN = 24 * 1024 * 1024;
const MAX_INLINE_URLS = 40;
const RESCAN_DELAY_MS = 1000;

const META_VIDEO_KEYS = /browser_native_|playable_url|[hs]d_src"/;
const META_VIDEO_URL =
  /"(?:browser_native_hd_url|browser_native_sd_url|playable_url_quality_hd|playable_url|hd_src|sd_src)"\s*:\s*"((?:[^"\\]|\\.){1,4096})"/g;
const PLAYER_CONFIG = /\bplayerConfig\s*=\s*\{/;

// Script element -> text length at its last scan, so unchanged scripts are skipped and streamed ones rescanned.
const scannedLength = new WeakMap();
let scanTimer = null;

function parseJson(text) {
  try {
    return JSON.parse(text);
  } catch (_error) {
    return undefined;
  }
}

/** Index of the brace closing the object that opens at `start`, skipping double-quoted strings. */
function closingBrace(source, start) {
  let depth = 0;
  for (let i = start; i < source.length; i++) {
    const code = source.charCodeAt(i);
    if (code === 34) {
      for (i += 1; i < source.length && source.charCodeAt(i) !== 34; i++) {
        if (source.charCodeAt(i) === 92) i += 1;
      }
    } else if (code === 123) {
      depth += 1;
    } else if (code === 125) {
      depth -= 1;
      if (depth === 0) return i;
    }
  }
  return -1;
}

function inlineScriptCandidates(text, context) {
  const found = [];
  const config = PLAYER_CONFIG.exec(text);
  if (config) {
    const start = config.index + config[0].length - 1;
    const end = closingBrace(text, start);
    const value = end > start ? parseJson(text.slice(start, end + 1)) : undefined;
    if (value !== undefined) extractJson(value, context).forEach((item) => found.push(item));
  }
  if (!META_VIDEO_KEYS.test(text)) return found;
  META_VIDEO_URL.lastIndex = 0;
  let match;
  for (let count = 0; count < MAX_INLINE_URLS && (match = META_VIDEO_URL.exec(text)) !== null; count++) {
    // The captured value keeps its JSON escapes (\/ and \u0026); httpUrl decodes them.
    const source = progressive(match[1], { hasAudio: true, mimeType: 'video/mp4' });
    if (source) {
      found.push(candidate({ site: context.site, key: urlKey(source.url), title: context.title, sources: [source], provenance: 'json' }));
    }
  }
  return found;
}

function scriptCandidates(script, context) {
  const type = String(script.getAttribute('type') || '').toLowerCase();
  const text = script.textContent || '';
  if (type === 'application/json' || type === 'application/ld+json') {
    const isPageData = PAGE_DATA_IDS.indexOf(script.getAttribute('id')) >= 0 || script.getAttribute('data-sjs') !== null;
    if (text.length > (isPageData ? MAX_PAGE_DATA_CHARS : MAX_JSON_SCRIPT_CHARS)) return [];
    const value = parseJson(text);
    return value === undefined ? [] : extractJson(value, context);
  }
  const isClassicScript = !type || type === 'text/javascript' || type === 'module';
  return isClassicScript && text.length <= MAX_INLINE_SCRIPT_CHARS ? inlineScriptCandidates(text, context) : [];
}

function scanDocument() {
  const context = contextFor('json', window.location.href);
  const found = [];
  const scripts = document.getElementsByTagName('script');
  let budget = MAX_CHARS_PER_SCAN;
  for (let i = 0; i < scripts.length && budget > 0; i++) {
    const script = scripts[i];
    const length = (script.textContent || '').length;
    if (!length || scannedLength.get(script) === length) continue;
    scannedLength.set(script, length);
    budget -= length;
    scriptCandidates(script, context).forEach((item) => found.push(item));
  }
  extractDom(document, contextFor('dom', window.location.href)).forEach((item) => found.push(item));
  if (found.length) emitCandidates(found);
}

function scheduleScan(delayMs) {
  if (scanTimer !== null) clearTimer(scanTimer);
  scanTimer = setTimer(
    guard(() => {
      scanTimer = null;
      scanDocument();
    }),
    delayMs,
  );
}

function install() {
  document.addEventListener('DOMContentLoaded', () => scheduleScan(0));
  window.addEventListener('load', () => scheduleScan(0));
  if (document.readyState !== 'loading') scheduleScan(0);
}

vdx.embedded = { install, rescanSoon: () => scheduleScan(RESCAN_DELAY_MS) };
