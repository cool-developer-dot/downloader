/**
 * B7 #66–#71 — the scripts the app runs in the page in front to find text. They only mark the page: matches are
 * highlighted with the CSS Custom Highlight API (no element is added or changed; the style is a constructed sheet in
 * `document.adoptedStyleSheets`), and the only thing sent back is a `find_result` with numbers on the browser-chrome
 * channel. The app puts in the user's search text (as a JSON string), two flags, a request id and numbers — no other
 * data.
 *
 * - Text nodes of the document's body are joined into one string (skipping script, style, noscript, template,
 *   textarea, select, and elements that aren't rendered), so a match can span elements (`Lah<b>ore</b>`).
 * - Match case off = case-insensitive (Unicode); Whole word = no letter, mark or digit (Unicode, so Urdu works) right
 *   before or after. Spaces in the search match any run of white space.
 * - At most `cap` matches are kept (`capped` tells the app); the current one gets the stronger highlight and is scrolled
 *   to the middle of its scroller.
 * - On a WebView without the Highlight API (Chromium < 105) only the current match is shown, as the page selection.
 *
 * Kept as plain string templates (Hermes doesn't keep function source, so nothing here is built with `toString()`).
 */

const CHANNEL = 'vidorax-browser-chrome';

/** Most matches a search keeps (the bar then shows "1000+"). */
export const FIND_MATCH_CAP = 1000;
/** Longest search text sent to the page. */
export const FIND_QUERY_MAX = 200;

/** A JS string literal for any text (JSON, plus the two line separators JSON leaves raw). */
export function jsString(value: string): string {
  return JSON.stringify(value).replace(/\u2028/g, '\\u2028').replace(/\u2029/g, '\\u2029');
}

const SHARED = `
  var CH = '${CHANNEL}';
  var post = function (requestId, current, total, capped) {
    try {
      if (window.ReactNativeWebView && window.ReactNativeWebView.postMessage) {
        window.ReactNativeWebView.postMessage(JSON.stringify({ channel: CH, type: 'find_result', payload: { requestId: requestId, current: current, total: total, capped: capped }, ts: Date.now() }));
      }
    } catch (e) {}
  };
  var hasHighlights = function () {
    return !!(window.CSS && CSS.highlights && typeof window.Highlight === 'function');
  };
  var clear = function () {
    var s = window.__vidoraxFind;
    if (!s) return;
    try {
      if (hasHighlights()) {
        CSS.highlights['delete']('vidorax-find');
        CSS.highlights['delete']('vidorax-find-current');
      } else if (s.selected) {
        var sel = window.getSelection && window.getSelection();
        if (sel) sel.removeAllRanges();
      }
    } catch (e) {}
    try {
      if (s.sheet && document.adoptedStyleSheets) {
        document.adoptedStyleSheets = Array.prototype.filter.call(document.adoptedStyleSheets, function (x) { return x !== s.sheet; });
      }
    } catch (e) {}
    window.__vidoraxFind = null;
  };
  var show = function (s) {
    var range = s.ranges[s.current];
    if (!range) return;
    try {
      if (hasHighlights()) {
        CSS.highlights.set('vidorax-find-current', new Highlight(range));
      } else {
        var sel = window.getSelection && window.getSelection();
        if (sel) { sel.removeAllRanges(); sel.addRange(range); s.selected = true; }
      }
    } catch (e) {}
    try {
      var node = range.startContainer;
      var el = node && node.nodeType === 1 ? node : node && node.parentElement;
      if (el && el.scrollIntoView) el.scrollIntoView({ block: 'center', inline: 'nearest' });
    } catch (e) {}
  };
`;

/**
 * A new search (also when the text or a toggle changed). An empty query clears and reports 0 matches.
 */
export function findScript(input: {
  requestId: number;
  query: string;
  matchCase: boolean;
  wholeWord: boolean;
  cap?: number;
}): string {
  const query = input.query.slice(0, FIND_QUERY_MAX);
  const requestId = Math.max(0, Math.trunc(input.requestId));
  const cap = Math.max(1, Math.min(FIND_MATCH_CAP, Math.trunc(input.cap ?? FIND_MATCH_CAP)));
  return `(function () {
  ${SHARED}
  var requestId = ${requestId};
  var query = ${jsString(query)};
  var matchCase = ${input.matchCase ? 'true' : 'false'};
  var wholeWord = ${input.wholeWord ? 'true' : 'false'};
  var CAP = ${cap};
  try {
    clear();
    if (!query.replace(/\\s+/g, '')) { post(requestId, 0, 0, false); return; }
    var body = document.body;
    if (!body || !document.createTreeWalker) { post(requestId, 0, 0, false); return; }
    var SKIP = { SCRIPT: 1, STYLE: 1, NOSCRIPT: 1, TEMPLATE: 1, TEXTAREA: 1, SELECT: 1, OPTION: 1 };
    var shown = new Map();
    var rendered = function (el) {
      if (shown.has(el)) return shown.get(el);
      var ok = !SKIP[String(el.tagName || '').toUpperCase()];
      if (ok && el.getClientRects) ok = el.getClientRects().length > 0;
      shown.set(el, ok);
      return ok;
    };
    var walker = document.createTreeWalker(body, 4, null);
    var nodes = [], starts = [], text = '', node;
    while ((node = walker.nextNode())) {
      var value = node.nodeValue || '';
      if (!value || !node.parentElement || !rendered(node.parentElement)) continue;
      nodes.push(node);
      starts.push(text.length);
      text += value;
    }
    var escaped = query.trim().replace(/[.*+?^\${}()|[\\]\\\\\\/]/g, '\\\\$&').replace(/\\s+/g, '\\\\s+');
    var source = wholeWord ? '(?<![\\\\p{L}\\\\p{M}\\\\p{N}_])' + escaped + '(?![\\\\p{L}\\\\p{M}\\\\p{N}_])' : escaped;
    var re = new RegExp(source, matchCase ? 'gu' : 'giu');
    var locate = function (offset) {
      var lo = 0, hi = starts.length - 1;
      while (lo < hi) {
        var mid = (lo + hi + 1) >> 1;
        if (starts[mid] <= offset) lo = mid; else hi = mid - 1;
      }
      return lo;
    };
    var ranges = [], capped = false, m;
    while ((m = re.exec(text))) {
      if (!m[0]) { re.lastIndex++; continue; }
      if (ranges.length >= CAP) { capped = true; break; }
      var a = locate(m.index), b = locate(m.index + m[0].length - 1);
      var range = document.createRange();
      range.setStart(nodes[a], m.index - starts[a]);
      range.setEnd(nodes[b], m.index + m[0].length - starts[b]);
      ranges.push(range);
    }
    var state = { ranges: ranges, current: 0, sheet: null, selected: false };
    window.__vidoraxFind = state;
    if (ranges.length === 0) { post(requestId, 0, 0, false); return; }
    if (hasHighlights()) {
      try {
        if (typeof CSSStyleSheet === 'function' && document.adoptedStyleSheets) {
          var sheet = new CSSStyleSheet();
          sheet.replaceSync('::highlight(vidorax-find){background-color:#FFE082;color:#000}::highlight(vidorax-find-current){background-color:#FF8F00;color:#000}');
          document.adoptedStyleSheets = Array.prototype.concat.call([], Array.prototype.slice.call(document.adoptedStyleSheets), [sheet]);
          state.sheet = sheet;
        }
      } catch (e) {}
      var all = new Highlight();
      for (var i = 0; i < ranges.length; i++) all.add(ranges[i]);
      CSS.highlights.set('vidorax-find', all);
    }
    show(state);
    post(requestId, 1, ranges.length, capped);
  } catch (e) {
    post(requestId, 0, 0, false);
  }
})();`;
}

/** Next (1) or previous (-1) match, wrapping around; reports the new position. */
export function findStepScript(requestId: number, delta: 1 | -1): string {
  const id = Math.max(0, Math.trunc(requestId));
  return `(function () {
  ${SHARED}
  var s = window.__vidoraxFind;
  if (!s || !s.ranges || s.ranges.length === 0) { post(${id}, 0, 0, false); return; }
  var n = s.ranges.length;
  s.current = (s.current + (${delta === -1 ? -1 : 1}) + n) % n;
  show(s);
  post(${id}, s.current + 1, n, n >= ${FIND_MATCH_CAP});
})();`;
}

/** Removes every highlight (the bar closed). Sends nothing. */
export const FIND_CLEAR_SCRIPT = `(function () {
  ${SHARED}
  clear();
})();`;
