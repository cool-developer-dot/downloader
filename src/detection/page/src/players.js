/* global vdx */
// <video> elements as ranking hints ('players' messages) and MediaSource codecs for blob: players. Media events
// are captured on the document, so players added at any time are found without observing DOM mutations.
const { httpUrl, positiveNumber, positiveInt, disguise, guard, setTimer, clearTimer } = vdx.util;
const { post, emitCandidates } = vdx.transport;
const { contextFor } = vdx.extract;
const { videoElementCandidates } = vdx.generic;

// Match the limits src/detection/messages.ts accepts.
const MAX_PLAYERS = 20;
const MAX_CODECS = 8;
const MAX_CODEC_LENGTH = 100;
const MAX_BLOB_URLS = 64;
const REFRESH_MS = 1000;
const URGENT_EVENTS = ['play', 'pause', 'ended'];
const QUIET_EVENTS = ['loadedmetadata', 'durationchange', 'resize', 'emptied'];

const players = [];
// MediaSource -> codec list, and blob: URL -> the same list. The URL map holds strings, never the MediaSource,
// so detached players and their buffers can still be collected.
const codecsBySource = new WeakMap();
const codecsByBlobUrl = new Map();
let lastPayload = '[]';
let lastRunAt = -Infinity;
let timer = null;
let urgentPending = false;

function track(video) {
  if (players.indexOf(video) >= 0) return;
  for (let i = players.length - 1; i >= 0 && players.length >= MAX_PLAYERS; i--) {
    if (players[i].isConnected === false) players.splice(i, 1);
  }
  if (players.length < MAX_PLAYERS) players.push(video);
}

function visibleRatio(element) {
  const rect = element.getBoundingClientRect();
  const area = rect.width * rect.height;
  if (!(area > 0)) return 0;
  const width = Math.max(0, Math.min(rect.right, window.innerWidth) - Math.max(rect.left, 0));
  const height = Math.max(0, Math.min(rect.bottom, window.innerHeight) - Math.max(rect.top, 0));
  return Math.round(((width * height) / area) * 100) / 100;
}

function hintFor(video) {
  const rawSrc = String(video.currentSrc || video.getAttribute('src') || '');
  const isBlob = rawSrc.indexOf('blob:') === 0;
  const hint = {};
  const src = isBlob ? null : httpUrl(rawSrc, window.location.href);
  if (src) hint.src = src;
  hint.isBlob = isBlob;
  const poster = httpUrl(video.getAttribute('poster'), window.location.href);
  if (poster) hint.poster = poster;
  const duration = positiveNumber(video.duration);
  if (duration !== undefined) hint.durationSec = Math.round(duration * 1000) / 1000;
  const width = positiveInt(video.videoWidth);
  if (width !== undefined) hint.width = width;
  const height = positiveInt(video.videoHeight);
  if (height !== undefined) hint.height = height;
  hint.playing = !video.paused && !video.ended;
  hint.visibleRatio = visibleRatio(video);
  const codecs = isBlob ? codecsByBlobUrl.get(rawSrc) : undefined;
  if (codecs && codecs.length) hint.mseCodecs = codecs.slice();
  return hint;
}

function update() {
  timer = null;
  urgentPending = false;
  lastRunAt = Date.now();
  for (let i = players.length - 1; i >= 0; i--) {
    if (players[i].isConnected === false) players.splice(i, 1);
  }
  const hints = players.map(hintFor);
  const payload = JSON.stringify(hints);
  if (payload !== lastPayload) {
    lastPayload = payload;
    post('players', { players: hints });
  }
  const context = contextFor('dom', window.location.href);
  const found = [];
  players.forEach((video) => videoElementCandidates(video, context).forEach((item) => found.push(item)));
  if (found.length) emitCandidates(found);
  if (hints.some((hint) => hint.playing)) requestUpdate(false);
}

const runUpdate = guard(update);

/** Urgent updates (play/pause) run on the next tick; others at most once per REFRESH_MS. */
function requestUpdate(urgent) {
  if (urgent) {
    if (urgentPending) return;
    if (timer !== null) clearTimer(timer);
    urgentPending = true;
    timer = setTimer(runUpdate, 0);
  } else if (timer === null) {
    timer = setTimer(runUpdate, Math.max(0, lastRunAt + REFRESH_MS - Date.now()));
  }
}

function onMediaEvent(event) {
  const target = event.target;
  if (!target || target.tagName !== 'VIDEO') return;
  track(target);
  requestUpdate(URGENT_EVENTS.indexOf(event.type) >= 0);
}

function discover() {
  const videos = document.getElementsByTagName('video');
  for (let i = 0; i < videos.length && i < MAX_PLAYERS; i++) track(videos[i]);
  if (players.length) requestUpdate(false);
}

function codecListFor(mediaSource) {
  let codecs = codecsBySource.get(mediaSource);
  if (!codecs) {
    codecs = [];
    codecsBySource.set(mediaSource, codecs);
  }
  return codecs;
}

function installMediaSourceHooks() {
  [window.MediaSource, window.ManagedMediaSource].forEach((MediaSourceType) => {
    const proto = typeof MediaSourceType === 'function' ? MediaSourceType.prototype : null;
    // ManagedMediaSource may inherit addSourceBuffer; wrapping it twice would record every codec twice.
    if (!proto || !Object.prototype.hasOwnProperty.call(proto, 'addSourceBuffer')) return;
    const original = proto.addSourceBuffer;
    proto.addSourceBuffer = disguise(function (...args) {
      const buffer = original.apply(this, args);
      try {
        const codecs = codecListFor(this);
        const type = String(args[0]).slice(0, MAX_CODEC_LENGTH);
        if (codecs.indexOf(type) < 0 && codecs.length < MAX_CODECS) codecs.push(type);
        if (players.length) requestUpdate(false);
      } catch (_error) {
        // The SourceBuffer exists either way.
      }
      return buffer;
    }, original);
  });

  const Url = window.URL;
  const originalCreate = Url && Url.createObjectURL;
  if (typeof originalCreate !== 'function') return;
  Url.createObjectURL = disguise(function (...args) {
    const url = originalCreate.apply(this, args);
    try {
      if (args[0] && typeof args[0].addSourceBuffer === 'function') {
        if (codecsByBlobUrl.size >= MAX_BLOB_URLS) codecsByBlobUrl.delete(codecsByBlobUrl.keys().next().value);
        codecsByBlobUrl.set(String(url), codecListFor(args[0]));
      }
    } catch (_error) {
      // The object URL exists either way.
    }
    return url;
  }, originalCreate);
}

function install() {
  const onEvent = guard(onMediaEvent);
  URGENT_EVENTS.concat(QUIET_EVENTS).forEach((type) => document.addEventListener(type, onEvent, true));
  window.addEventListener(
    'scroll',
    guard(() => {
      if (players.length) requestUpdate(false);
    }),
    { capture: true, passive: true },
  );
  const onReady = guard(discover);
  document.addEventListener('DOMContentLoaded', onReady);
  window.addEventListener('load', onReady);
  if (document.readyState !== 'loading') onReady();
  installMediaSourceHooks();
}

vdx.players = { install };
