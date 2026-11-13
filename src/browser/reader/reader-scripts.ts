/**
 * B15 #161 — the two scripts reader mode runs in the page in front (Mozilla Readability needs a DOM, and the app's JS
 * engine has none). Both carry only a request number from the app; the page's answer comes back on the
 * `vidorax-reader` channel (its own channel: an article is far larger than the browser-chrome channel's 50 KB cap).
 *
 * - `readerCheckScript` runs Readability's `isProbablyReaderable` (a cheap look at the page's paragraphs) and answers
 *   `{ type: 'state', readerable }`. The reader button shows only on pages that answer true.
 * - `readerExtractScript` runs `new Readability(document.cloneNode(true)).parse()` on a copy of the page (the page
 *   itself is not changed) and answers `{ type: 'article', ... }` with the article's HTML, title, byline, site name,
 *   language and direction. The HTML is sanitised in the app before anything is shown (`reader-sanitize.ts`).
 *
 * Readability's own source runs inside a function, so it adds nothing to the page's globals. Plain string templates
 * (Hermes doesn't keep function source).
 */
import { READABILITY_SOURCE, READERABLE_SOURCE } from './vendor/readability-source';

export const READER_CHANNEL = 'vidorax-reader';

/** Longest article HTML the page sends (characters); longer articles are cut (the sanitiser closes open tags). */
export const READER_HTML_MAX = 2_000_000;

const POST = `
  var post = function (payload) {
    try {
      if (window.ReactNativeWebView && window.ReactNativeWebView.postMessage) {
        window.ReactNativeWebView.postMessage(JSON.stringify({ channel: '${READER_CHANNEL}', payload: payload }));
      }
    } catch (e) {}
  };
`;

function requestNumber(requestId: number): number {
  return Number.isInteger(requestId) && requestId >= 0 ? requestId : 0;
}

export function readerCheckScript(requestId: number): string {
  const id = requestNumber(requestId);
  return `(function () {
  ${POST}
  var readerable = false;
  try {
    var module = undefined;
    ${READERABLE_SOURCE}
    readerable = !!(document.body && isProbablyReaderable(document));
  } catch (e) {}
  post({ type: 'state', requestId: ${id}, readerable: readerable, url: String(location.href) });
})(); true;`;
}

export function readerExtractScript(requestId: number): string {
  const id = requestNumber(requestId);
  return `(function () {
  ${POST}
  var url = String(location.href);
  try {
    var module = undefined;
    ${READABILITY_SOURCE}
    var article = new Readability(document.cloneNode(true), { charThreshold: 300 }).parse();
    if (!article || !article.content) {
      post({ type: 'article', requestId: ${id}, ok: false, url: url });
      return;
    }
    var html = String(article.content);
    var lang = article.lang || (document.documentElement && document.documentElement.lang) || '';
    post({
      type: 'article',
      requestId: ${id},
      ok: true,
      url: url,
      title: String(article.title || document.title || ''),
      byline: String(article.byline || ''),
      siteName: String(article.siteName || ''),
      lang: String(lang),
      dir: String(article.dir || ''),
      html: html.length > ${READER_HTML_MAX} ? html.slice(0, ${READER_HTML_MAX}) : html,
      truncated: html.length > ${READER_HTML_MAX}
    });
  } catch (e) {
    post({ type: 'article', requestId: ${id}, ok: false, url: url });
  }
})(); true;`;
}
