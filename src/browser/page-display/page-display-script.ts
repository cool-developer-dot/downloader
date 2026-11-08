/**
 * B16 #165 / #170 / #272 — what Page display changes inside the page: a style sheet and the viewport tag. No data from
 * the app goes in (three fixed choices); nothing comes back.
 *
 * - **Font style (#170)**: Sans / Serif / Monospace for the page's text with `!important`, except icon fonts (elements
 *   marked as icons by the common icon-font classes, `i`, `[aria-hidden="true"]`, `[data-icon]`, SVG) and code, which
 *   keep their own fonts.
 * - **Urdu in Nastaliq (#272)**: only text marked Urdu (`:lang(ur)`) and only its Arabic-script letters (the font face's
 *   `unicode-range`); the face is the phone's own Noto Nastaliq Urdu (`local()`). The bundled copy would need the
 *   WebView to load it from the app — BLOCKED (see the B16 notes); without a phone font the page is unchanged.
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

/** The style sheet for these choices ('' = nothing to change). */
export function pageDisplayCss(options: PageDisplayScriptOptions): string {
  let css = '';
  if (options.fontStyle !== 'default') {
    const family = FAMILY[options.fontStyle];
    css += `body, body :not(${KEEP_FONT}) { font-family: ${family} !important; }\n`;
  }
  if (options.urduNastaliq) {
    css +=
      `@font-face { font-family: "VidoraX Nastaliq"; src: local("Noto Nastaliq Urdu"), local("NotoNastaliqUrdu-Regular"), local("Noto Nastaliq Urdu Regular"); unicode-range: ${ARABIC_RANGE}; }\n` +
      `:lang(ur), :lang(ur) :not(${KEEP_FONT}) { font-family: "VidoraX Nastaliq", ${options.fontStyle === 'default' ? 'sans-serif' : FAMILY[options.fontStyle]} !important; }\n`;
  }
  return css;
}

/** The script (document start, and again on a change). */
export function pageDisplayScript(options: PageDisplayScriptOptions): string {
  const css = JSON.stringify(pageDisplayCss(options));
  return `(function () {
  try {
    var state = window.__vidoraxDisplay || (window.__vidoraxDisplay = {});
    var css = ${css};
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
    if (!document.head) document.addEventListener('DOMContentLoaded', put, { once: true });
  } catch (e) {}
})(); true;`;
}
