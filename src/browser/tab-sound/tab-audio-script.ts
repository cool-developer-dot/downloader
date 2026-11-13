/**
 * B3 #8 / #220 — mute and volume for one tab, applied in its page. Installed only in a tab the user muted or turned
 * down (at document start for its next pages, and at once in the page shown). Nothing goes back to the app: whether
 * the page plays sound is still B6's `media_state` report ("playing" / "not playing").
 *
 * How: `HTMLMediaElement.prototype`'s `volume` and `muted` are wrapped, so every audio / video element plays at
 * `pageVolume × tabVolume` and is muted when the page or the tab says so, while the page keeps reading its own values
 * (its player UI, and B6's report, stay right). `play()` applies the tab's values first, which also covers elements
 * that aren't in the document (`new Audio()`). Values put in are a flag and a number only.
 *
 * Not covered: sound made with the Web Audio API, and players inside cross-origin frames.
 */

/** 0–100 % → 0–1, clamped. */
export function tabVolumeFraction(percent: number): number {
  if (!Number.isFinite(percent)) return 1;
  return Math.max(0, Math.min(100, Math.round(percent))) / 100;
}

export function tabAudioScript(muted: boolean, volumePercent: number): string {
  const volume = tabVolumeFraction(volumePercent);
  return `(function () {
  try {
    var P = window.HTMLMediaElement && HTMLMediaElement.prototype;
    if (!P) return;
    var S = window.__vidoraxTabAudio;
    if (!S) {
      var dv = Object.getOwnPropertyDescriptor(P, 'volume');
      var dm = Object.getOwnPropertyDescriptor(P, 'muted');
      if (!dv || !dm || !dv.get || !dv.set || !dm.get || !dm.set) return;
      S = window.__vidoraxTabAudio = { muted: false, volume: 1, pv: new WeakMap(), pm: new WeakMap() };
      var remember = function (el) {
        if (!S.pv.has(el)) S.pv.set(el, dv.get.call(el));
        if (!S.pm.has(el)) S.pm.set(el, dm.get.call(el));
      };
      S.apply = function (el) {
        try {
          remember(el);
          dv.set.call(el, Math.max(0, Math.min(1, S.pv.get(el) * S.volume)));
          dm.set.call(el, S.pm.get(el) || S.muted);
        } catch (e) {}
      };
      Object.defineProperty(P, 'volume', {
        configurable: true,
        enumerable: dv.enumerable,
        get: function () { return S.pv.has(this) ? S.pv.get(this) : dv.get.call(this); },
        set: function (value) {
          dv.set.call(this, value);
          S.pv.set(this, dv.get.call(this));
          S.apply(this);
        },
      });
      Object.defineProperty(P, 'muted', {
        configurable: true,
        enumerable: dm.enumerable,
        get: function () { return S.pm.has(this) ? S.pm.get(this) : dm.get.call(this); },
        set: function (value) {
          S.pm.set(this, !!value);
          S.apply(this);
        },
      });
      var play = P.play;
      if (typeof play === 'function') {
        P.play = function () {
          S.apply(this);
          return play.apply(this, arguments);
        };
      }
    }
    S.muted = ${muted ? 'true' : 'false'};
    S.volume = ${volume};
    var media = document.querySelectorAll ? document.querySelectorAll('video, audio') : [];
    for (var i = 0; i < media.length; i++) S.apply(media[i]);
  } catch (e) {}
})();`;
}
