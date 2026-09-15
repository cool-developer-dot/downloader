/* global vdx */
// Entry point for one frame: announce it, stop on YouTube, otherwise install every tap.
const { isYouTubeHost } = vdx.util;
const { post } = vdx.transport;

function start() {
  if (!/^https?:$/.test(window.location.protocol)) return;
  post('hello', {});
  if (isYouTubeHost(window.location.hostname)) {
    post('policy', { blocked: 'youtube' });
    return;
  }
  [
    vdx.taps.installFetchTap,
    vdx.taps.installXhrTap,
    vdx.players.install,
    vdx.drm.install,
    vdx.embedded.install,
    vdx.navigation.install,
  ].forEach((install) => {
    try {
      install();
    } catch (_error) {
      // One missing or locked-down API must not keep the other taps out.
    }
  });
}

start();
