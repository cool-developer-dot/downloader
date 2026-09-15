/* global vdx */
// DRM is reported when the page actually uses it: MediaKeys attached to a media element, or an 'encrypted' event
// from encrypted media. A requestMediaKeySystemAccess call alone only names the key system, because players and
// ad SDKs call it to probe support on pages that play clear content.
const { disguise, guard } = vdx.util;
const { post } = vdx.transport;

const reported = Object.create(null);
let requestedKeySystem = '';

const report = guard(() => {
  const keySystem = (requestedKeySystem || 'unknown').slice(0, 100);
  if (reported[keySystem]) return;
  reported[keySystem] = true;
  post('drm', { keySystem });
});

function install() {
  const navigator = window.navigator;
  const originalRequest = navigator && navigator.requestMediaKeySystemAccess;
  if (typeof originalRequest === 'function') {
    navigator.requestMediaKeySystemAccess = disguise(function (...args) {
      if (typeof args[0] === 'string') requestedKeySystem = args[0];
      return originalRequest.apply(this, args);
    }, originalRequest);
  }

  const proto = window.HTMLMediaElement && window.HTMLMediaElement.prototype;
  const originalSetMediaKeys = proto && proto.setMediaKeys;
  if (typeof originalSetMediaKeys === 'function') {
    proto.setMediaKeys = disguise(function (...args) {
      if (args[0]) report();
      return originalSetMediaKeys.apply(this, args);
    }, originalSetMediaKeys);
  }

  document.addEventListener('encrypted', report, true);
}

vdx.drm = { install };
