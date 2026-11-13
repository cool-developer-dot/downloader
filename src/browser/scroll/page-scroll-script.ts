/**
 * B6 — the scripts the app runs in the shown page to scroll it (Scroll to top / bottom, a Volume-key step, Auto
 * scroll). They only scroll: they read nothing from the page beyond its scroll position and send back only
 * `auto_scroll` events (`bottom`, `touched`) on the browser-chrome channel. Every value put into a script is a number
 * or a fixed word (never page or user data). The page's main scroller is the document when it scrolls, otherwise
 * the biggest visible element that scrolls (web apps that scroll a container instead of the page).
 */

const CHANNEL = 'vidorax-browser-chrome';

const FIND_SCROLLER = `function vxScroller() {
  var d = document, root = d.scrollingElement || d.documentElement;
  if (root && root.scrollHeight > root.clientHeight + 2) return root;
  var best = null, area = 0, all = d.querySelectorAll('body *'), n = Math.min(all.length, 4000);
  for (var i = 0; i < n; i++) {
    var el = all[i];
    if (el.scrollHeight <= el.clientHeight + 2 || el.clientHeight < window.innerHeight * 0.4) continue;
    var oy = getComputedStyle(el).overflowY;
    if (oy !== 'auto' && oy !== 'scroll') continue;
    var a = el.clientWidth * el.clientHeight;
    if (a > area) { area = a; best = el; }
  }
  return best || root;
}
function vxIsRoot(s) { return s === document.scrollingElement || s === document.documentElement || s === document.body; }
function vxTop(s) { return vxIsRoot(s) ? (window.scrollY || window.pageYOffset || s.scrollTop || 0) : s.scrollTop; }
function vxView(s) { return vxIsRoot(s) ? window.innerHeight : s.clientHeight; }
function vxScrollTo(s, top, smooth) {
  var options = { top: top, behavior: smooth ? 'smooth' : 'auto' };
  if (vxIsRoot(s)) window.scrollTo(options); else s.scrollTo(options);
}`;

function wrap(body: string): string {
  return `(function () {\ntry {\n${FIND_SCROLLER}\n${body}\n} catch (e) {}\n})();\ntrue;`;
}

/** #46 / #47: smooth scroll to the top or the bottom of the page. */
export function scrollToEdgeScript(edge: 'top' | 'bottom'): string {
  const toTop = edge === 'top';
  return wrap(`var s = vxScroller(); vxScrollTo(s, ${toTop ? '0' : 's.scrollHeight'}, true);`);
}

/** #240 / #53: one step down (1) or up (-1), `fraction` of the visible height. */
export function scrollStepScript(direction: 1 | -1, fraction: number): string {
  const share = Number.isFinite(fraction) ? Math.max(0.1, Math.min(1, fraction)) : 0.85;
  return wrap(`var s = vxScroller(); vxScrollTo(s, vxTop(s) + ${direction} * ${share} * vxView(s), true);`);
}

export type AutoScrollCommand =
  | { type: 'start' | 'speed'; pixelsPerSecond: number }
  | { type: 'pause' | 'stop' };

/**
 * #54: drives the page's auto-scroll loop (installed once per page). It scrolls `pixelsPerSecond` on animation
 * frames, reports `bottom` and stops when the page ends, and reports `touched` and pauses on a touch or a wheel.
 */
export function autoScrollScript(command: AutoScrollCommand): string {
  const speed =
    'pixelsPerSecond' in command && Number.isFinite(command.pixelsPerSecond)
      ? Math.max(1, Math.min(2000, command.pixelsPerSecond))
      : 0;
  return wrap(`var KEY = '__vidoraxAutoScroll';
var c = window[KEY];
if (!c) {
  c = { running: false, speed: 40, acc: 0, last: 0, raf: 0, scroller: null };
  var post = function (event) {
    try {
      if (window.ReactNativeWebView && window.ReactNativeWebView.postMessage) {
        window.ReactNativeWebView.postMessage(JSON.stringify({ channel: '${CHANNEL}', type: 'auto_scroll', payload: { event: event }, ts: Date.now() }));
      }
    } catch (e) {}
  };
  var halt = function () { c.running = false; if (c.raf) cancelAnimationFrame(c.raf); c.raf = 0; };
  var frame = function (t) {
    c.raf = 0;
    if (!c.running) return;
    var dt = c.last ? Math.min(100, t - c.last) : 16;
    c.last = t;
    c.acc += c.speed * dt / 1000;
    var step = Math.floor(c.acc);
    if (step >= 1) {
      c.acc -= step;
      var s = c.scroller, before = vxTop(s);
      vxScrollTo(s, before + step, false);
      var max = s.scrollHeight - vxView(s);
      if (vxTop(s) <= before && before >= max - 1) { halt(); post('bottom'); return; }
    }
    c.raf = requestAnimationFrame(frame);
  };
  var onUser = function () { if (c.running) { halt(); post('touched'); } };
  document.addEventListener('touchstart', onUser, { capture: true, passive: true });
  document.addEventListener('wheel', onUser, { capture: true, passive: true });
  c.start = function () { c.scroller = vxScroller(); c.running = true; c.last = 0; c.acc = 0; if (!c.raf) c.raf = requestAnimationFrame(frame); };
  c.halt = halt;
  try { Object.defineProperty(window, KEY, { value: c, configurable: true }); } catch (e) { window[KEY] = c; }
}
${
  command.type === 'start'
    ? `c.speed = ${speed}; c.start();`
    : command.type === 'speed'
      ? `c.speed = ${speed};`
      : 'c.halt();'
}`);
}
