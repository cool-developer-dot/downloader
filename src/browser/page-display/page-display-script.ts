/**
 * B16 #165 / #170 / #272 — what Page display changes inside the page: a style sheet and the viewport tag. No data from
 * the app goes in (three fixed choices); nothing comes back.
 *
 * - **Font style (#170)**: Sans / Serif / Monospace for the page's text with `!important`, except icon fonts (elements
 *   marked as icons by the common icon-font classes, `i`, `[aria-hidden="true"]`, `[data-icon]`, SVG) and code, which
 *   keep their own fonts.
 * - **Urdu in Nastaliq (#272)**: only text marked Urdu (`:lang(ur)`) and only its Arabic-script letters (the font face's
 *   `unicodeRange`); the face is the phone's own Noto Nastaliq Urdu (`local()`), loaded with the `FontFace` API. The
 *   Urdu rule is added **only after that font has loaded** (its own style element), so on a phone without it the page
 *   keeps its own fonts. The bundled copy would need the WebView to load it from the app — BLOCKED (B16 notes).
 * - **Force enable zoom (#165)**: the page's viewport tag loses `user-scalable=no` and a maximum scale below 5, so
 *   pinch zoom always works (WebView's built-in zoom is already on, without on-screen buttons). Tags added or changed
 *   later are fixed too.
 *
 * The same script runs at document start (every new page) and is injected again when a choice changes (the page in
 * front updates at once). Plain string templates (Hermes doesn't keep function source).
 */
import type { PageFontStyle } from './page-display-settings';

export type PageDisplayScriptOptions = { fontStyle: PageFontStyle; urduNastaliq: boolean; forceZoom: boolean };

/** Elements whose font stays: icon fonts and code. */
const KEEP_FONT = [
  'i',
  'code',
  'pre',
  'kbd',
  'samp',
  'svg',
  'svg *',
  'math',
  '[aria-hidden="true"]',
  '[data-icon]',
  '[class*="icon" i]',
  '[class*="fa-"]',
  '.fa',
  '.fas',
  '.far',
  '.fab',
  '.fal',
  '[class*="material-icons"]',
  '[class*="material-symbols"]',
  '[class*="glyphicon"]',
  '[class*="dashicons"]',
  '[class*="octicon"]',
].join(',');

const FAMILY: Record<Exclude<PageFontStyle, 'default'>, string> = {
  sans: 'sans-serif',
  serif: 'serif',
  monospace: 'monospace',
};

const ARABIC_RANGE = 'U+0600-06FF, U+0750-077F, U+08A0-08FF, U+FB50-FDFF, U+FE70-FEFF';

/** The font-style sheet for these choices ('' = nothing to change). */
export function pageDisplayCss(options: PageDisplayScriptOptions): string {
  if (options.fontStyle === 'default') return '';
  return `body, body :not(${KEEP_FONT}) { font-family: ${FAMILY[options.fontStyle]} !important; }\n`;
}

/** The phone's Nastaliq, by its names. */
export const NASTALIQ_LOCAL_SOURCES =
  'local("Noto Nastaliq Urdu"), local("NotoNastaliqUrdu-Regular"), local("Noto Nastaliq Urdu Regular")';

/** The Urdu rule, added only once the phone's Nastaliq has loaded. */
export function urduRuleCss(fontStyle: PageFontStyle): string {
  const fallback = fontStyle === 'default' ? 'sans-serif' : FAMILY[fontStyle];
  return `:lang(ur), :lang(ur) :not(${KEEP_FONT}) { font-family: "VidoraX Nastaliq", ${fallback} !important; }\n`;
}

/** The script (document start, and again on a change). */
export function pageDisplayScript(options: PageDisplayScriptOptions): string {
  const css = JSON.stringify(pageDisplayCss(options));
  const urduCss = JSON.stringify(options.urduNastaliq ? urduRuleCss(options.fontStyle) : '');
  return `(function () {
  try {
    var state = window.__vidoraxDisplay || (window.__vidoraxDisplay = {});
    var css = ${css};
    var urduCss = ${urduCss};
    var putUrdu = function (text) {
      var root = document.documentElement;
      if (!root) return;
      var el = document.getElementById('vidorax-page-urdu');
      if (!text) {
        if (el && el.parentNode) el.parentNode.removeChild(el);
        return;
      }
      if (!el) {
        el = document.createElement('style');
        el.id = 'vidorax-page-urdu';
      }
      if (el.textContent !== text) el.textContent = text;
      var parent = document.head || root;
      if (el.parentNode !== parent) parent.appendChild(el);
    };
    var urduToken = (state.urduToken || 0) + 1;
    state.urduToken = urduToken;
    if (!urduCss) {
      putUrdu('');
    } else if (state.urduFont === 'loaded') {
      putUrdu(urduCss);
    } else if (window.FontFace && document.fonts && document.fonts.add) {
      // Only with the phone's own Nastaliq: without it the page keeps its own fonts.
      var face = new FontFace('VidoraX Nastaliq', ${JSON.stringify(NASTALIQ_LOCAL_SOURCES)}, { unicodeRange: ${JSON.stringify(ARABIC_RANGE)} });
      face.load().then(function (loaded) {
        document.fonts.add(loaded);
        state.urduFont = 'loaded';
        if (state.urduToken === urduToken) putUrdu(urduCss);
      }, function () {
        if (state.urduToken === urduToken) putUrdu('');
      });
    }
    var forceZoom = ${options.forceZoom ? 'true' : 'false'};
    var put = function () {
      var root = document.documentElement;
      if (!root) return false;
      var el = state.style && state.style.isConnected ? state.style : document.getElementById('vidorax-page-display');
      if (!css) {
        if (el && el.parentNode) el.parentNode.removeChild(el);
        state.style = null;
        return true;
      }
      if (!el) {
        el = document.createElement('style');
        el.id = 'vidorax-page-display';
      }
      if (el.textContent !== css) el.textContent = css;
      var parent = document.head || root;
      if (el.parentNode !== parent) parent.appendChild(el);
      state.style = el;
      return true;
    };
    var fixViewport = function (meta) {
      var content = meta.getAttribute('content');
      if (typeof content !== 'string') return;
      var parts = content.split(/[,;]/).map(function (p) { return p.trim(); }).filter(function (p) {
        if (!p) return false;
        var key = p.split('=')[0].trim().toLowerCase();
        var value = (p.split('=')[1] || '').trim().toLowerCase();
        if (key === 'user-scalable') return false;
        if (key === 'maximum-scale' && !(parseFloat(value) >= 5)) return false;
        return true;
      });
      var hasMax = parts.some(function (p) { return p.split('=')[0].trim().toLowerCase() === 'maximum-scale'; });
      if (!hasMax) parts.push('maximum-scale=5');
      parts.push('user-scalable=yes');
      var next = parts.join(', ');
      if (next !== content) meta.setAttribute('content', next);
    };
    var fixAll = function () {
      if (!forceZoom) return;
      var metas = document.querySelectorAll('meta[name="viewport" i]');
      for (var i = 0; i < metas.length; i += 1) fixViewport(metas[i]);
    };
    state.forceZoom = forceZoom;
    if (!put()) document.addEventListener('readystatechange', put, { once: true });
    fixAll();
    if (forceZoom && !state.observer && window.MutationObserver && document.documentElement) {
      state.observer = new MutationObserver(function (records) {
        if (!window.__vidoraxDisplay.forceZoom) return;
        for (var i = 0; i < records.length; i += 1) {
          var r = records[i];
          if (r.type === 'attributes') {
            if (r.target.nodeName === 'META') fixViewport(r.target);
          } else {
            for (var j = 0; j < r.addedNodes.length; j += 1) {
              var n = r.addedNodes[j];
              if (n.nodeName === 'META' && String(n.getAttribute('name')).toLowerCase() === 'viewport') fixViewport(n);
            }
          }
        }
        // The style sheet stays last in <head> even when the page replaces <head>'s children.
        if (state.style && !state.style.isConnected) put();
      });
      state.observer.observe(document.documentElement, { childList: true, subtree: true, attributes: true, attributeFilter: ['content'] });
    }
    if (!document.head) {
      document.addEventListener('DOMContentLoaded', function () {
        put();
        var urdu = document.getElementById('vidorax-page-urdu');
        if (urdu && document.head && urdu.parentNode !== document.head) document.head.appendChild(urdu);
      }, { once: true });
    }
  } catch (e) {}
})(); true;`;
}
