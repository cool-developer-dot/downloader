import { BROWSER_CHROME_CHANNEL } from './browser-chrome.channel';

/**
 * Long-press + scroll observers for the active document.
 * Fixed script string only — never interpolated from page content.
 */
export function buildBrowserChromeInjectedScript(): string {
  return `(function(){
  if (window.__VIDORAX_BROWSER_CHROME__) { return true; }
  window.__VIDORAX_BROWSER_CHROME__ = true;

  var CHANNEL = ${JSON.stringify(BROWSER_CHROME_CHANNEL)};
  var LONG_PRESS_MS = 420;
  var SCROLL_THROTTLE_MS = 200;
  var PULL_THRESHOLD_PX = 72;
  var pressTimer = null;
  var pressTarget = null;
  var lastScrollPost = 0;
  var touchMoved = false;
  var startX = 0;
  var startY = 0;
  var lastPostedPageUrl = '';
  var pullTracking = false;
  var pullStartY = 0;
  var pullFired = false;
  var lastPullPostAt = 0;

  function post(type, payload) {
    try {
      if (!window.ReactNativeWebView || !window.ReactNativeWebView.postMessage) {
        return;
      }
      window.ReactNativeWebView.postMessage(JSON.stringify({
        channel: CHANNEL,
        type: type,
        payload: payload,
        ts: Date.now()
      }));
    } catch (e) {}
  }

  function closestAnchor(node) {
    var el = node;
    while (el && el !== document && el !== document.documentElement) {
      if (el.tagName && el.tagName.toLowerCase() === 'a' && el.href) {
        return el;
      }
      el = el.parentElement || el.parentNode;
    }
    return null;
  }

  function safeHref(anchor) {
    try {
      var href = anchor.href;
      if (!href || typeof href !== 'string') return null;
      var lower = href.trim().toLowerCase();
      if (!lower || lower.indexOf('javascript:') === 0 || lower === '#' ||
          lower.indexOf('blob:') === 0 || lower.indexOf('data:') === 0 ||
          lower.indexOf('file:') === 0) {
        return null;
      }
      if (lower.indexOf('http://') !== 0 && lower.indexOf('https://') !== 0 &&
          lower.indexOf('mailto:') !== 0 && lower.indexOf('tel:') !== 0) {
        return null;
      }
      return href;
    } catch (e) { return null; }
  }

  function clearPress() {
    if (pressTimer) {
      clearTimeout(pressTimer);
      pressTimer = null;
    }
    pressTarget = null;
    touchMoved = false;
  }

  function emitLongPress(anchor, x, y) {
    var href = safeHref(anchor);
    if (!href) return;
    var text = (anchor.innerText || anchor.textContent || '').trim().slice(0, 500);
    post('link_long_press', {
      href: href,
      text: text,
      x: x || 0,
      y: y || 0,
      pageUrl: location.href
    });
  }

  function onContextMenu(event) {
    var anchor = closestAnchor(event.target);
    if (!anchor) return;
    var href = safeHref(anchor);
    if (!href) return;
    try { event.preventDefault(); } catch (e) {}
    try { event.stopPropagation(); } catch (e) {}
    emitLongPress(
      anchor,
      event.clientX || 0,
      event.clientY || 0
    );
  }

  function onTouchStart(event) {
    if (!event.touches || event.touches.length !== 1) return;
    var anchor = closestAnchor(event.target);
    if (!anchor || !safeHref(anchor)) return;
    var touch = event.touches[0];
    startX = touch.clientX || 0;
    startY = touch.clientY || 0;
    touchMoved = false;
    pressTarget = anchor;
    if (pressTimer) clearTimeout(pressTimer);
    pressTimer = setTimeout(function() {
      if (!pressTarget || touchMoved) return;
      emitLongPress(pressTarget, startX, startY);
      pressTarget = null;
    }, LONG_PRESS_MS);
  }

  function onTouchMove(event) {
    if (!pressTimer || !event.touches || !event.touches[0]) return;
    var touch = event.touches[0];
    var dx = Math.abs((touch.clientX || 0) - startX);
    var dy = Math.abs((touch.clientY || 0) - startY);
    if (dx > 10 || dy > 10) {
      touchMoved = true;
      clearPress();
    }
  }

  try {
    var style = document.createElement('style');
    style.setAttribute('data-vidorax-chrome', '1');
    style.textContent = 'a,a *{-webkit-touch-callout:none;}';
    (document.head || document.documentElement).appendChild(style);
  } catch (e) {}

  function onScroll() {
    var now = Date.now();
    if (now - lastScrollPost < SCROLL_THROTTLE_MS) return;
    lastScrollPost = now;
    var y = window.scrollY || window.pageYOffset ||
      (document.documentElement && document.documentElement.scrollTop) || 0;
    var pageUrl = location.href;
    var payload = { scrollY: y };
    if (pageUrl !== lastPostedPageUrl) {
      lastPostedPageUrl = pageUrl;
      payload.pageUrl = pageUrl;
    }
    post('scroll', payload);
  }

  function pageScrollY() {
    return window.scrollY || window.pageYOffset ||
      (document.documentElement && document.documentElement.scrollTop) || 0;
  }

  function onPullTouchStart(event) {
    if (!event.touches || event.touches.length !== 1) return;
    if (pageScrollY() > 1) {
      pullTracking = false;
      return;
    }
    pullTracking = true;
    pullFired = false;
    pullStartY = event.touches[0].clientY || 0;
  }

  function onPullTouchMove(event) {
    if (!pullTracking || pullFired || !event.touches || !event.touches[0]) return;
    if (pageScrollY() > 1) {
      pullTracking = false;
      return;
    }
    var dy = (event.touches[0].clientY || 0) - pullStartY;
    if (dy > PULL_THRESHOLD_PX) {
      var now = Date.now();
      // Guard duplicate refresh posts from one continuous gesture / bounce.
      if (now - lastPullPostAt < 1200) {
        pullFired = true;
        pullTracking = false;
        return;
      }
      pullFired = true;
      pullTracking = false;
      lastPullPostAt = now;
      post('pull_to_refresh', {});
    }
  }

  function onPullTouchEnd() {
    pullTracking = false;
  }

  function cleanup() {
    try {
      clearPress();
      document.removeEventListener('contextmenu', onContextMenu, true);
      document.removeEventListener('touchstart', onTouchStart, true);
      document.removeEventListener('touchmove', onTouchMove, true);
      document.removeEventListener('touchend', clearPress, true);
      document.removeEventListener('touchcancel', clearPress, true);
      document.removeEventListener('touchstart', onPullTouchStart, true);
      document.removeEventListener('touchmove', onPullTouchMove, true);
      document.removeEventListener('touchend', onPullTouchEnd, true);
      document.removeEventListener('touchcancel', onPullTouchEnd, true);
      window.removeEventListener('scroll', onScroll);
      window.removeEventListener('pagehide', cleanup);
      if (routeTitleTimer) { clearTimeout(routeTitleTimer); routeTitleTimer = null; }
      window.__VIDORAX_BROWSER_CHROME__ = false;
    } catch (e) {}
  }

  document.addEventListener('contextmenu', onContextMenu, true);
  document.addEventListener('touchstart', onTouchStart, { capture: true, passive: true });
  document.addEventListener('touchmove', onTouchMove, { capture: true, passive: true });
  document.addEventListener('touchend', clearPress, { capture: true, passive: true });
  document.addEventListener('touchcancel', clearPress, { capture: true, passive: true });
  document.addEventListener('touchstart', onPullTouchStart, { capture: true, passive: true });
  document.addEventListener('touchmove', onPullTouchMove, { capture: true, passive: true });
  document.addEventListener('touchend', onPullTouchEnd, { capture: true, passive: true });
  document.addEventListener('touchcancel', onPullTouchEnd, { capture: true, passive: true });
  window.addEventListener('scroll', onScroll, { passive: true });
  window.addEventListener('pagehide', cleanup);

  // An SPA names its new route after pushState returns (after rendering, often after a fetch): the title read at the
  // route change is still the previous route's. Look again for a few seconds and report the name once it changes.
  var routeTitleTimer = null;
  function watchRouteTitle(href, previousTitle) {
    var checks = 0;
    if (routeTitleTimer) { clearTimeout(routeTitleTimer); routeTitleTimer = null; }
    function check() {
      routeTitleTimer = null;
      if (!window.__VIDORAX_BROWSER_CHROME__ || window.location.href !== href) return;
      if (document.title !== previousTitle) {
        if (document.title) post('spa_navigation', { url: href, title: document.title });
        return;
      }
      checks += 1;
      if (checks < 12) routeTitleTimer = setTimeout(check, 250);
    }
    routeTitleTimer = setTimeout(check, 250);
  }

  function emitSpaNavigation() {
    try {
      var href = window.location.href;
      if (!href || href === 'about:blank') return;
      post('spa_navigation', {
        url: href,
        title: document.title || ''
      });
      watchRouteTitle(href, document.title);
    } catch (e) {}
  }

  function wrapHistory(methodName) {
    try {
      var original = history[methodName];
      if (!original || original.__vidoraxWrapped) return;
      history[methodName] = function() {
        var result = original.apply(this, arguments);
        emitSpaNavigation();
        return result;
      };
      history[methodName].__vidoraxWrapped = true;
    } catch (e) {}
  }

  wrapHistory('pushState');
  wrapHistory('replaceState');
  window.addEventListener('popstate', emitSpaNavigation, { passive: true });

  post('ready', {});
  true;
})();`;
}

/** Lightweight before-content stub so the flag survives SPA navigations that re-inject. */
export function buildBrowserChromeBeforeContentScript(): string {
  return `(function(){ try { window.__VIDORAX_BROWSER_CHROME__ = false; } catch(e) {} true; })();`;
}
