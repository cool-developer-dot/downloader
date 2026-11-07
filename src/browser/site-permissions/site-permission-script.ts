/**
 * B13 #117–#120 — the document-start script in every page. It answers the page's own requests and tells the app only
 * what was asked: a `site_permission` with the kind (`location` / `camera` / `microphone` / `notifications`), at most
 * once per kind per page, and a `popup_blocked` with the address a page tried to open without a tap. Nothing from the
 * app goes in (no list of allowed sites: the app decides what to do with a blocked pop-up).
 *
 * - Location: `navigator.geolocation` answers PERMISSION_DENIED (WebView already has geolocation off).
 * - Camera / microphone: `getUserMedia` rejects with NotAllowedError (the app has no such permission).
 * - Notifications: `Notification.permission` is "denied" and `requestPermission()` resolves "denied" (Android WebView
 *   has no web notifications; a stub is defined so a page that asks gets a clear answer).
 * - Pop-ups: `window.open` without the user's tap (`navigator.userActivation.isActive` false) returns null, as does a
 *   script's untrusted click on a `target=_blank` link. A tapped `window.open` and every real link tap are untouched,
 *   so the existing new-window handling runs as before. A WebView without `userActivation` (Chromium < 72) blocks
 *   nothing.
 */

const CHANNEL = 'vidorax-browser-chrome';

export const SITE_PERMISSION_PAGE_SCRIPT = `(function () {
  if (window.__vidoraxSitePermissions) return;
  window.__vidoraxSitePermissions = true;
  var post = function (type, payload) {
    try {
      if (window.ReactNativeWebView && window.ReactNativeWebView.postMessage) {
        window.ReactNativeWebView.postMessage(JSON.stringify({ channel: '${CHANNEL}', type: type, payload: payload, ts: Date.now() }));
      }
    } catch (e) {}
  };
  var told = {};
  var tell = function (kind) {
    if (told[kind]) return;
    told[kind] = true;
    post('site_permission', { kind: kind });
  };
  var denied = function () {
    try { return new DOMException('Permission denied', 'NotAllowedError'); } catch (e) { var err = new Error('Permission denied'); err.name = 'NotAllowedError'; return err; }
  };
  try {
    var geo = navigator.geolocation;
    if (geo) {
      var geoError = function (onError) {
        tell('location');
        if (typeof onError === 'function') {
          setTimeout(function () {
            try { onError({ code: 1, message: 'User denied Geolocation', PERMISSION_DENIED: 1, POSITION_UNAVAILABLE: 2, TIMEOUT: 3 }); } catch (e) {}
          }, 0);
        }
      };
      geo.getCurrentPosition = function (onSuccess, onError) { geoError(onError); };
      geo.watchPosition = function (onSuccess, onError) { geoError(onError); return 0; };
    }
  } catch (e) {}
  try {
    var media = navigator.mediaDevices;
    var ask = function (constraints) {
      var c = constraints || {};
      if (c.video) tell('camera');
      if (c.audio) tell('microphone');
      if (!c.video && !c.audio) tell('camera');
    };
    if (media && media.getUserMedia) {
      media.getUserMedia = function (constraints) { ask(constraints); return Promise.reject(denied()); };
    }
    var legacy = function (constraints, onSuccess, onError) {
      ask(constraints);
      if (typeof onError === 'function') setTimeout(function () { try { onError(denied()); } catch (e) {} }, 0);
    };
    if (navigator.getUserMedia) navigator.getUserMedia = legacy;
    if (navigator.webkitGetUserMedia) navigator.webkitGetUserMedia = legacy;
  } catch (e) {}
  try {
    var request = function (callback) {
      tell('notifications');
      if (typeof callback === 'function') setTimeout(function () { try { callback('denied'); } catch (e) {} }, 0);
      return Promise.resolve('denied');
    };
    if (typeof window.Notification === 'function') {
      window.Notification.requestPermission = request;
    } else {
      var Stub = function () { tell('notifications'); throw new TypeError('Notifications are not allowed'); };
      Stub.permission = 'denied';
      Stub.requestPermission = request;
      window.Notification = Stub;
    }
  } catch (e) {}
  try {
    var activation = navigator.userActivation;
    if (activation && typeof window.open === 'function') {
      var open = window.open;
      var absolute = function (url) {
        try { return url ? String(new URL(String(url), location.href)) : ''; } catch (e) { return ''; }
      };
      window.open = function (url) {
        if (activation.isActive) return open.apply(window, arguments);
        post('popup_blocked', { url: absolute(url) });
        return null;
      };
      document.addEventListener('click', function (event) {
        if (event.isTrusted) return;
        var el = event.target;
        while (el && el.tagName !== 'A') el = el.parentElement;
        if (!el || String(el.target || '').toLowerCase() !== '_blank' || activation.isActive) return;
        event.preventDefault();
        post('popup_blocked', { url: absolute(el.href) });
      }, true);
    }
  } catch (e) {}
})();`;
