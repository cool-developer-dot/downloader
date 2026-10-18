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
  var PULL_MAX_ANCESTORS = 64;

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

  function overscrollContained(el) {
    try {
      var value = getComputedStyle(el).overscrollBehaviorY;
      return value === 'contain' || value === 'none';
    } catch (e) { return false; }
  }

  // Whether a downward drag starting on this target would scroll the page's root (and may refresh it), as a browser
  // decides: never when a scroller around the target is scrolled away from its top (the drag scrolls it back, the
  // gesture stays latched to it), nor when that scroller or the root opts out with overscroll-behavior-y.
  function pullReachesRoot(event) {
    var path = null;
    try { path = event.composedPath ? event.composedPath() : null; } catch (e) { path = null; }
    var nodes = [];
    if (path && path.length) {
      nodes = path;
    } else {
      for (var n = event.target; n && nodes.length < PULL_MAX_ANCESTORS; n = n.parentNode || n.host) nodes.push(n);
    }
    var root = document.scrollingElement || document.documentElement;
    for (var i = 0; i < nodes.length && i < PULL_MAX_ANCESTORS; i++) {
      var el = nodes[i];
      if (!el || el.nodeType !== 1 || el === root || el === document.body || el === document.documentElement) continue;
      if ((el.scrollTop || 0) > 0) return false;
      if (el.scrollHeight > el.clientHeight + 1) {
        var overflowY = '';
        try { overflowY = getComputedStyle(el).overflowY; } catch (e) {}
        if ((overflowY === 'auto' || overflowY === 'scroll') && overscrollContained(el)) return false;
      }
    }
    return !(root && overscrollContained(root)) && !(document.body && overscrollContained(document.body));
  }

  function onPullTouchStart(event) {
    if (!event.touches || event.touches.length !== 1) return;
    if (pageScrollY() > 1 || !pullReachesRoot(event)) {
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

  // Bubble phase, after the page's own listeners: a page that handles the drag itself (a map, a drawing surface, a
  // custom slider) prevents it, and that drag is not a pull.
  function onPullTouchMoveHandled(event) {
    if (pullTracking && event.defaultPrevented) pullTracking = false;
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
      window.removeEventListener('touchmove', onPullTouchMoveHandled, false);
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
  window.addEventListener('touchmove', onPullTouchMoveHandled, { capture: false, passive: true });
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

/**
 * How long after leaving fullscreen the page is scrolled back to where it was (react-native-webview's video view
 * resets the page to the top; the rotation back to portrait relayouts it). A touch on the page ends it sooner.
 */
export const FULLSCREEN_RESTORE_MS = 1500;

/** Elements searched for the fullscreen video (open shadow roots and same-origin frames included). */
const FULLSCREEN_SCAN_MAX_NODES = 3000;

/**
 * Document-start script for every main-frame document. Resets the long-press/scroll script's flag so it re-installs
 * after SPA navigations, and installs the fullscreen observer: on `fullscreenchange` it posts `fullscreen` with the
 * fullscreen video's size (src/browser/fullscreen decides the orientation), and keeps the page's place across
 * fullscreen. Fixed script string only — never interpolated from page content.
 */
export function buildBrowserChromeBeforeContentScript(): string {
  return `(function(){
  try { window.__VIDORAX_BROWSER_CHROME__ = false; } catch (e) {}
  try {
    if (window.__VIDORAX_FULLSCREEN__) { return true; }
    window.__VIDORAX_FULLSCREEN__ = true;
  } catch (e) { return true; }

  var CHANNEL = ${JSON.stringify(BROWSER_CHROME_CHANNEL)};
  var MAX_NODES = ${FULLSCREEN_SCAN_MAX_NODES};
  var RESTORE_MS = ${FULLSCREEN_RESTORE_MS};
  var NUMERIC_LENGTH = /^\\s*\\d+(\\.\\d+)?\\s*(px)?\\s*$/i;
  var lastKey = 'false:0x0';
  var watched = null;
  var lastX = 0;
  var lastY = 0;
  var saved = null;
  var restoring = null;
  var restoreTimer = null;

  function post(payload) {
    try {
      if (!window.ReactNativeWebView || !window.ReactNativeWebView.postMessage) { return; }
      window.ReactNativeWebView.postMessage(JSON.stringify({
        channel: CHANNEL,
        type: 'fullscreen',
        payload: payload,
        ts: Date.now()
      }));
    } catch (e) {}
  }

  function fullscreenElement() {
    var d = document;
    return d.fullscreenElement || d.webkitFullscreenElement || null;
  }

  function tagOf(node) {
    return node && node.tagName ? String(node.tagName).toLowerCase() : '';
  }

  function videoSize(video) {
    var w = video.videoWidth, h = video.videoHeight;
    return w > 0 && h > 0 ? { width: w, height: h } : null;
  }

  function frameSize(frame) {
    try {
      var w = frame.getAttribute('width'), h = frame.getAttribute('height');
      if (!NUMERIC_LENGTH.test(w || '') || !NUMERIC_LENGTH.test(h || '')) { return null; }
      w = parseFloat(w); h = parseFloat(h);
      return w > 0 && h > 0 ? { width: w, height: h } : null;
    } catch (e) { return null; }
  }

  function scan(root) {
    var found = { videos: [], frames: [] };
    var stack = [root];
    var seen = 0;
    while (stack.length && seen < MAX_NODES) {
      var node = stack.pop();
      seen++;
      var tag = tagOf(node);
      if (tag === 'video') {
        found.videos.push(node);
      } else if (tag === 'iframe' || tag === 'frame') {
        var doc = null;
        try { doc = node.contentDocument; } catch (e) {}
        if (doc && doc.documentElement) { stack.push(doc.documentElement); } else { found.frames.push(node); }
      }
      if (node.shadowRoot) { stack.push(node.shadowRoot); }
      var kids = node.children;
      if (kids) {
        for (var i = kids.length - 1; i >= 0; i--) { stack.push(kids[i]); }
      }
    }
    return found;
  }

  function area(el) {
    try { var r = el.getBoundingClientRect(); return r.width * r.height; } catch (e) { return 0; }
  }

  function pick(videos) {
    var best = null, bestRank = -1, bestArea = -1;
    for (var i = 0; i < videos.length; i++) {
      var v = videos[i];
      var rank = (!v.paused && !v.ended ? 2 : 0) + (videoSize(v) ? 1 : 0);
      var a = area(v);
      if (rank > bestRank || (rank === bestRank && a > bestArea)) {
        best = v; bestRank = rank; bestArea = a;
      }
    }
    return best;
  }

  function describe(el) {
    var found = scan(el);
    var video = pick(found.videos);
    var size = video ? videoSize(video) : null;
    for (var i = 0; !size && i < found.frames.length; i++) { size = frameSize(found.frames[i]); }
    return { video: video, size: size };
  }

  function unwatch() {
    if (watched) {
      try {
        watched.removeEventListener('loadedmetadata', report);
        watched.removeEventListener('resize', report);
      } catch (e) {}
    }
    watched = null;
  }

  function watch(video) {
    if (watched === video) { return; }
    unwatch();
    watched = video;
    if (video) {
      try {
        video.addEventListener('loadedmetadata', report);
        video.addEventListener('resize', report);
      } catch (e) {}
    }
  }

  function report() {
    var el = fullscreenElement();
    var payload = { active: false };
    if (el) {
      var d = describe(el);
      watch(d.video);
      payload = d.size ? { active: true, width: d.size.width, height: d.size.height } : { active: true };
    } else {
      unwatch();
    }
    var key = payload.active + ':' + (payload.width || 0) + 'x' + (payload.height || 0);
    if (key === lastKey) { return; }
    lastKey = key;
    post(payload);
  }

  // Layout viewport width: unlike innerWidth it does not follow pinch zoom (pages without a viewport meta).
  function viewportWidth() {
    var root = document.documentElement;
    return (root && root.clientWidth) || window.innerWidth || 0;
  }

  function stopRestore() {
    restoring = null;
    if (restoreTimer) { clearInterval(restoreTimer); restoreTimer = null; }
  }

  function tryRestore() {
    var target = restoring;
    if (!target) { return; }
    if (Date.now() > target.until) { stopRestore(); return; }
    if (viewportWidth() !== target.width) { return; }
    var x = window.scrollX || 0, y = window.scrollY || 0;
    if (Math.abs(x - target.x) > 2 || Math.abs(y - target.y) > 2) {
      try { window.scrollTo(target.x, target.y); } catch (e) {}
    }
  }

  function startRestore(place) {
    stopRestore();
    if (!place.x && !place.y) { return; }
    restoring = { x: place.x, y: place.y, width: place.width, until: Date.now() + RESTORE_MS };
    tryRestore();
    restoreTimer = setInterval(tryRestore, 100);
  }

  function onFullscreenChange() {
    var el = fullscreenElement();
    if (el && !saved) {
      stopRestore();
      var x = window.scrollX || 0, y = window.scrollY || 0;
      if (!x && !y) { x = lastX; y = lastY; }
      saved = { x: x, y: y, width: viewportWidth() };
    } else if (!el && saved) {
      var place = saved;
      saved = null;
      startRestore(place);
    }
    report();
  }

  function onScroll() {
    if (fullscreenElement() || restoring) { return; }
    lastX = window.scrollX || 0;
    lastY = window.scrollY || 0;
  }

  function onUserInput() {
    if (restoring) { stopRestore(); }
  }

  try {
    document.addEventListener('fullscreenchange', onFullscreenChange, true);
    document.addEventListener('webkitfullscreenchange', onFullscreenChange, true);
    window.addEventListener('scroll', onScroll, { passive: true });
    window.addEventListener('touchstart', onUserInput, { capture: true, passive: true });
    window.addEventListener('wheel', onUserInput, { capture: true, passive: true });
    window.addEventListener('keydown', onUserInput, true);
  } catch (e) {}
  true;
})();`;
}

/** Asks the page to leave fullscreen (the app's Back, a tab switch, backgrounding, leaving the Browser). */
export function buildBrowserExitFullscreenScript(): string {
  return `(function(){
  try {
    var d = document;
    if (d.fullscreenElement && d.exitFullscreen) {
      var p = d.exitFullscreen();
      if (p && p.catch) { p.catch(function(){}); }
    } else if (d.webkitFullscreenElement && d.webkitExitFullscreen) {
      d.webkitExitFullscreen();
    }
  } catch (e) {}
})();
true;`;
}
