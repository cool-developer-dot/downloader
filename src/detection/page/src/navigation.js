/* global vdx */
// Single-page navigation: History API calls, popstate and hashchange post 'nav' and schedule a rescan of the
// page data. Reported on the next tick so the message follows the page's own synchronous route change, and only
// when the URL actually changed (some sites call replaceState on every scroll).
const { disguise, guard, setTimer } = vdx.util;
const { post } = vdx.transport;
const { rescanSoon } = vdx.embedded;

let lastUrl = '';
let pending = false;

const reportNavigation = guard(() => {
  pending = false;
  const url = String(window.location.href);
  if (url === lastUrl) return;
  lastUrl = url;
  post('nav', { url: url.slice(0, 4096), title: document.title ? String(document.title).slice(0, 300) : undefined });
  rescanSoon();
});

function scheduleReport() {
  if (pending) return;
  pending = true;
  setTimer(reportNavigation, 0);
}

function install() {
  lastUrl = String(window.location.href);
  const history = window.history;
  ['pushState', 'replaceState'].forEach((method) => {
    const original = history && history[method];
    if (typeof original !== 'function') return;
    history[method] = disguise(function (...args) {
      const result = original.apply(this, args);
      scheduleReport();
      return result;
    }, original);
  });
  window.addEventListener('popstate', scheduleReport);
  window.addEventListener('hashchange', scheduleReport);
}

vdx.navigation = { install };
