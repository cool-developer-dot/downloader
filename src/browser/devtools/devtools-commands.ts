import { DEVTOOLS_MESSAGE } from './devtools-core';

/**
 * B19 — the page commands the panel injects on the user's request (nothing runs by itself). Each one runs in the page
 * with the page's own rights and posts its answer back on the devtools channel. Values from the app that go in are
 * the user's own input (the console line, a storage key), as JSON strings.
 */

const post = (body: string) =>
  `try { window.ReactNativeWebView.postMessage(JSON.stringify(Object.assign({ type: '${DEVTOOLS_MESSAGE}' }, ${body}))); } catch (e) {}`;

/** #223: runs the user's JavaScript in the page (never in the app) and posts the result or the error. */
export function evalCommand(code: string): string {
  return `(function () {
  var show = function (value) {
    try {
      if (typeof value === 'string') return value;
      if (value === undefined) return 'undefined';
      if (typeof value === 'function') return String(value).slice(0, 300);
      return JSON.stringify(value, null, 2);
    } catch (e) { return String(value); }
  };
  try {
    var value = (0, eval)(${JSON.stringify(code.slice(0, 20_000))});
    ${post(`{ kind: 'eval', ok: true, text: show(value).slice(0, 4000) }`)}
  } catch (error) {
    ${post(`{ kind: 'eval', ok: false, text: String(error && error.stack || error).slice(0, 4000) }`)}
  }
})();
true;`;
}

/** #224 / #231: the page's resources from the Resource Timing API (no headers, no bodies), and mixed content. */
export const NETWORK_COMMAND = `(function () {
  try {
    var list = (performance.getEntriesByType('navigation') || []).concat(performance.getEntriesByType('resource') || []);
    var https = location.protocol === 'https:';
    var mixed = 0;
    var entries = list.slice(-500).map(function (e) {
      if (https && /^http:/i.test(e.name)) mixed++;
      return {
        url: e.name,
        type: e.initiatorType || e.entryType,
        size: typeof e.transferSize === 'number' && e.transferSize > 0 ? e.transferSize : (e.encodedBodySize || null),
        ms: e.duration,
        status: typeof e.responseStatus === 'number' && e.responseStatus > 0 ? e.responseStatus : null
      };
    });
    ${post(`{ kind: 'network', entries: entries, mixed: mixed, https: https }`)}
  } catch (e) {}
})();
true;`;

/**
 * #222: inspect element. `start` waits for the next tap on the page (the tap selects instead of clicking), outlines the
 * element and posts what it is; `parent` / `child` / `next` move the selection; `stop` removes the outline. Read-only:
 * nothing on the page changes except the outline.
 */
export function inspectCommand(action: 'start' | 'parent' | 'child' | 'next' | 'stop'): string {
  return `(function () {
  try {
    var S = window.__vidoraxInspect || (window.__vidoraxInspect = {});
    var describe = function (el) {
      if (!el) { ${post(`{ kind: 'inspect', info: null }`)} return; }
      var r = el.getBoundingClientRect();
      var cs = getComputedStyle(el);
      var styles = {};
      ['display', 'position', 'width', 'height', 'margin', 'padding', 'font-family', 'font-size', 'font-weight', 'color', 'background-color', 'border', 'z-index'].forEach(function (k) { styles[k] = cs.getPropertyValue(k); });
      var html = el.outerHTML || '';
      var info = {
        tag: el.tagName.toLowerCase(), id: el.id || '', classes: Array.prototype.slice.call(el.classList || []),
        width: r.width, height: r.height, styles: styles,
        html: html.length > 4000 ? html.slice(0, 4000) + '…' : html,
        children: el.children ? el.children.length : 0, hasParent: !!(el.parentElement && el.parentElement !== document.documentElement)
      };
      ${post(`{ kind: 'inspect', info: info }`)}
    };
    var outline = function (el) {
      if (!S.box) {
        S.box = document.createElement('div');
        S.box.setAttribute('aria-hidden', 'true');
        S.box.style.cssText = 'position:fixed;pointer-events:none;z-index:2147483647;outline:2px solid #1a73e8;background:rgba(26,115,232,0.15);';
      }
      if (!S.box.isConnected) (document.body || document.documentElement).appendChild(S.box);
      var r = el.getBoundingClientRect();
      S.box.style.left = r.left + 'px'; S.box.style.top = r.top + 'px';
      S.box.style.width = r.width + 'px'; S.box.style.height = r.height + 'px';
    };
    var select = function (el) { if (!el) return; S.el = el; outline(el); describe(el); };
    var action = ${JSON.stringify(action)};
    if (action === 'stop') {
      if (S.box && S.box.parentNode) S.box.parentNode.removeChild(S.box);
      if (S.handler) document.removeEventListener('click', S.handler, true);
      S.handler = null; S.el = null;
      return;
    }
    if (action === 'start') {
      if (S.handler) document.removeEventListener('click', S.handler, true);
      S.handler = function (event) {
        event.preventDefault(); event.stopPropagation();
        document.removeEventListener('click', S.handler, true);
        S.handler = null;
        select(event.target);
      };
      document.addEventListener('click', S.handler, true);
      return;
    }
    if (!S.el) return;
    if (action === 'parent' && S.el.parentElement && S.el.parentElement !== document.documentElement) select(S.el.parentElement);
    if (action === 'child' && S.el.firstElementChild) select(S.el.firstElementChild);
    if (action === 'next' && S.el.nextElementSibling) select(S.el.nextElementSibling);
  } catch (e) {}
})();
true;`;
}

/** #225: the page's source, fetched again inside the page (same cookies), in parts of 200,000 characters (2 MB at most). */
export const SOURCE_COMMAND = `(function () {
  try {
    fetch(location.href, { credentials: 'include' }).then(function (r) { return r.text(); }).then(function (text) {
      var max = 2000000;
      var truncated = text.length > max;
      if (truncated) text = text.slice(0, max);
      var size = 200000;
      var of = Math.max(1, Math.ceil(text.length / size));
      for (var i = 0; i < of; i++) {
        var part = text.slice(i * size, (i + 1) * size);
        ${post(`{ kind: 'source', part: i, of: of, text: part, truncated: truncated }`)}
      }
    }).catch(function (e) {
      ${post(`{ kind: 'source', part: 0, of: 1, text: '', truncated: false, error: String(e) }`)}
    });
  } catch (e) {}
})();
true;`;

/** #230: the page's localStorage and sessionStorage (values cut to 2,000 characters). */
export const STORAGE_READ_COMMAND = `(function () {
  try {
    var items = [];
    [['local', window.localStorage], ['session', window.sessionStorage]].forEach(function (pair) {
      try {
        var store = pair[1];
        for (var i = 0; i < store.length && items.length < 500; i++) {
          var key = store.key(i);
          items.push({ area: pair[0], key: key, value: String(store.getItem(key)).slice(0, 2000) });
        }
      } catch (e) {}
    });
    ${post(`{ kind: 'storage', items: items }`)}
  } catch (e) {}
})();
true;`;

/** #230: deletes one storage item (then reads again), or clears both stores with `key` null. */
export function storageDeleteCommand(area: 'local' | 'session' | null, key: string | null): string {
  return `(function () {
  try {
    var area = ${JSON.stringify(area)};
    var key = ${JSON.stringify(key)};
    if (key === null) {
      try { localStorage.clear(); } catch (e) {}
      try { sessionStorage.clear(); } catch (e) {}
    } else {
      (area === 'session' ? sessionStorage : localStorage).removeItem(key);
    }
  } catch (e) {}
})();
${STORAGE_READ_COMMAND}`;
}
