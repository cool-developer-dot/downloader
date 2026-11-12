/**
 * Injected page observer — DOM / Performance / fetch / XHR observation.
 *
 * Security constraints:
 * - Fixed script string only (never built from page content)
 * - Posts structured JSON to ReactNativeWebView
 * - Does not touch cookies, storage, or auth tokens
 * - Never exposes blob: URLs as downloadable media
 */
import { DETECTION_TIMING } from '../constants';
import { MEDIA_BRIDGE_CHANNEL } from '../types';

const VIDEO_EXTS =
  'mp4|webm|mov|m4v|f4v|mkv|avi|divx|mpeg|mpg|m2ts|3gp|3g2|flv|wmv|ogv';
const AUDIO_EXTS = 'mp3|m4a|aac|ogg|opus|wav|flac';
const STREAM_EXTS = 'm3u8|mpd';
/** .ts excluded from extension-alone matching — segment noise. */

/** After an SPA route change the page title is looked at this often, this many times (3 s), for the route's own name. */
const ROUTE_TITLE_CHECK_MS = 250;
const ROUTE_TITLE_CHECKS = 12;

/**
 * MediaSource observation, shared by both injected scripts and installed once per document by whichever runs first —
 * normally the before-content script, at document start, so a player that builds its MediaSource while the page is
 * still loading (the first video of a feed) is seen; the main script, injected when the page has loaded, adopts the
 * state and receives the events. Observation only: every original is called and its result returned untouched.
 *
 * - `objectUrls`/`sourcesByUrl`: media blob: URLs → 'mse' | 'blob' and the MediaSource behind each (bounded).
 * - `recent`: MediaSources seen through addSourceBuffer; each carries `__vidoraxTracks` (per buffer 'v' | 'a' | 'av'),
 *   each SourceBuffer its `__vidoraxKind`/`__vidoraxSource`.
 * - Bytes read with Response.arrayBuffer or an arraybuffer XHR remember their URL (weakly); an appendBuffer of those
 *   bytes names the file feeding that SourceBuffer: `MediaSource.__vidoraxFiles = { v, a }` — the video file and the
 *   audio file of a split player.
 * - A media response read as a stream (`response.body`, chunk by chunk) keeps its latest chunks (bounded); a player
 *   that copies those bytes into the buffers it appends is named by the one file whose chunks hold the appended bytes.
 * - `emeRequested`: the page negotiated encrypted media (a protection signal; no key system is touched).
 */
const MSE_OBSERVATION_SOURCE = `
  function vidoraxMseObservation() {
    if (window.__VIDORAX_MSE__) return window.__VIDORAX_MSE__;
    var state = {
      objectUrls: Object.create(null),
      objectUrlKeys: [],
      sourcesByUrl: Object.create(null),
      recent: [],
      bufferUrls: typeof WeakMap === 'function' ? new WeakMap() : null,
      emeRequested: false,
      listener: null
    };
    try {
      Object.defineProperty(window, '__VIDORAX_MSE__', { value: state, configurable: false, enumerable: false, writable: false });
    } catch (e) {
      window.__VIDORAX_MSE__ = state;
    }
    var MAX_OBJECT_URLS = 24;
    var MAX_SOURCES = 8;
    // Streamed media chunks kept for naming appended bytes, and how often one SourceBuffer may be looked up in them.
    var MAX_STREAM_CHUNKS = 64;
    var MAX_STREAM_BYTES = 3 * 1024 * 1024;
    var STREAM_MATCH_BYTES = 128;
    var MIN_STREAM_MATCH_BYTES = 32;
    var STREAM_MATCH_UNKNOWN_MS = 250;
    var STREAM_MATCH_KNOWN_MS = 1000;
    state.streamChunks = [];
    state.streamBytes = 0;
    var VIDEO_CODEC_RE = /^(avc[1-4]|hev1|hvc1|dvh[1e]|dva[1v]|vp0?[89]|vp09|av01|mp4v|theora)/i;
    var AUDIO_CODEC_RE = /^(mp4a|opus|vorbis|flac|ac-3|ec-3|mp3|alac|dtsc)/i;
    function notify(event, detail) {
      try { if (typeof state.listener === 'function') state.listener(event, detail); } catch (e) {}
    }
    function rememberBuffer(buf, url) {
      try {
        if (state.bufferUrls && buf && typeof buf === 'object' && url && /^https?:/i.test(String(url))) {
          state.bufferUrls.set(buf, String(url).slice(0, 2048));
        }
      } catch (e) {}
    }
    // A MediaSource carries no type property, so its methods identify it; a Blob is media by its type.
    function objectUrlSourceKind(obj) {
      try {
        if (!obj) return null;
        if (typeof obj.addSourceBuffer === 'function') return 'mse';
        var ctor = obj.constructor && obj.constructor.name ? String(obj.constructor.name) : '';
        if (ctor.indexOf('MediaSource') >= 0) return 'mse';
        var type = obj.type ? String(obj.type).toLowerCase() : '';
        if (type.indexOf('video') === 0 || type.indexOf('audio') === 0) return 'blob';
        if (type.indexOf('application/vnd.apple.mpegurl') === 0 || type.indexOf('application/dash+xml') === 0) return 'blob';
      } catch (e) {}
      return null;
    }
    // The MIME type given to addSourceBuffer says whether one buffer carries video, audio or both.
    function sourceBufferTrackKind(mime) {
      try {
        var text = String(mime || '').toLowerCase();
        var m = /codecs\\s*=\\s*"?([^";]+)"?/.exec(text);
        var video = false, audio = false;
        if (m) {
          var codecs = m[1].split(',');
          for (var i = 0; i < codecs.length; i++) {
            var c = codecs[i].replace(/^\\s+|\\s+$/g, '');
            if (VIDEO_CODEC_RE.test(c)) video = true;
            else if (AUDIO_CODEC_RE.test(c)) audio = true;
          }
        } else if (text.indexOf('audio/') === 0) {
          audio = true;
        }
        if (video && audio) return 'av';
        if (video) return 'v';
        if (audio) return 'a';
      } catch (e) {}
      return null;
    }
    try {
      if (window.Response && Response.prototype && typeof Response.prototype.arrayBuffer === 'function' &&
          !Response.prototype.arrayBuffer.__vidoraxHooked) {
        var _arrayBuffer = Response.prototype.arrayBuffer;
        var arrayBufferHooked = function() {
          var res = this;
          return _arrayBuffer.apply(this, arguments).then(function(buf) {
            rememberBuffer(buf, res && res.url);
            return buf;
          });
        };
        arrayBufferHooked.__vidoraxHooked = true;
        Response.prototype.arrayBuffer = arrayBufferHooked;
      }
    } catch (e) {}
    try {
      var XP = window.XMLHttpRequest && XMLHttpRequest.prototype;
      if (XP && typeof XP.send === 'function' && !XP.send.__vidoraxBuffers) {
        var _send = XP.send;
        var sendHooked = function() {
          var xhr = this;
          try {
            xhr.addEventListener('load', function() {
              try {
                if (xhr.responseType === 'arraybuffer') rememberBuffer(xhr.response, xhr.responseURL || xhr.__vidoraxUrl);
              } catch (e2) {}
            }, { once: true });
          } catch (e3) {}
          return _send.apply(this, arguments);
        };
        sendHooked.__vidoraxBuffers = true;
        XP.send = sendHooked;
      }
    } catch (e) {}
    function isMediaResponse(res) {
      try {
        var type = String((res.headers && res.headers.get('content-type')) || '').toLowerCase();
        if (type.indexOf('video/') === 0 || type.indexOf('audio/') === 0) return true;
        var path = String(res.url || '').split('?')[0].split('#')[0].toLowerCase();
        var dot = path.lastIndexOf('.');
        var ext = dot >= 0 ? path.slice(dot + 1) : '';
        return ext === 'mp4' || ext === 'm4s' || ext === 'm4v' || ext === 'm4a' || ext === 'webm' || ext === 'cmfv' ||
          ext === 'cmfa';
      } catch (e) { return false; }
    }
    function rememberStreamChunk(url, value) {
      try {
        if (!value || !value.byteLength) return;
        var chunk = typeof ArrayBuffer === 'function' && value instanceof ArrayBuffer ? new Uint8Array(value) : value;
        if (!chunk.buffer || typeof chunk.BYTES_PER_ELEMENT !== 'number') return;
        if (chunk.BYTES_PER_ELEMENT !== 1) chunk = new Uint8Array(chunk.buffer, chunk.byteOffset, chunk.byteLength);
        rememberBuffer(chunk.buffer, url);
        state.streamChunks.push({ url: String(url).slice(0, 2048), bytes: chunk, length: chunk.byteLength });
        state.streamBytes += chunk.byteLength;
        while (state.streamChunks.length > MAX_STREAM_CHUNKS || state.streamBytes > MAX_STREAM_BYTES) {
          state.streamBytes -= state.streamChunks.shift().length;
        }
      } catch (e) {}
    }
    // A media response's body stream, and the reader taken from it, carry the response URL; each chunk read is kept.
    try {
      var bodyDesc = window.Response && Response.prototype && Object.getOwnPropertyDescriptor(Response.prototype, 'body');
      if (bodyDesc && typeof bodyDesc.get === 'function' && !bodyDesc.get.__vidoraxHooked) {
        var getBody = bodyDesc.get;
        var bodyHooked = function() {
          var stream = getBody.call(this);
          try {
            if (stream && !stream.__vidoraxUrl && /^https?:/i.test(String(this.url || '')) && isMediaResponse(this)) {
              stream.__vidoraxUrl = String(this.url);
            }
          } catch (e2) {}
          return stream;
        };
        bodyHooked.__vidoraxHooked = true;
        Object.defineProperty(Response.prototype, 'body', {
          get: bodyHooked,
          configurable: true,
          enumerable: bodyDesc.enumerable
        });
      }
      var RS = window.ReadableStream && ReadableStream.prototype;
      if (RS && typeof RS.getReader === 'function' && !RS.getReader.__vidoraxHooked) {
        var _getReader = RS.getReader;
        var getReaderHooked = function() {
          var reader = _getReader.apply(this, arguments);
          try { if (reader && this.__vidoraxUrl) reader.__vidoraxUrl = this.__vidoraxUrl; } catch (e3) {}
          return reader;
        };
        getReaderHooked.__vidoraxHooked = true;
        RS.getReader = getReaderHooked;
      }
      // A body piped through a transform (a progress counter, a chunker) or teed is still that file's bytes.
      if (RS && typeof RS.pipeThrough === 'function' && !RS.pipeThrough.__vidoraxHooked) {
        var _pipeThrough = RS.pipeThrough;
        var pipeThroughHooked = function() {
          var out = _pipeThrough.apply(this, arguments);
          try { if (out && this.__vidoraxUrl) out.__vidoraxUrl = this.__vidoraxUrl; } catch (e5) {}
          return out;
        };
        pipeThroughHooked.__vidoraxHooked = true;
        RS.pipeThrough = pipeThroughHooked;
      }
      // Piped into the page's own sink: the bytes never pass a reader, so the pipe goes through a pass-through tap that
      // keeps each chunk (same bytes, same order, errors and cancellation still propagate).
      if (RS && typeof RS.pipeTo === 'function' && typeof RS.pipeThrough === 'function' &&
          typeof window.TransformStream === 'function' && !RS.pipeTo.__vidoraxHooked) {
        var _pipeTo = RS.pipeTo;
        var nativePipeThrough = _pipeThrough || RS.pipeThrough;
        var pipeToHooked = function() {
          var url = this.__vidoraxUrl;
          var source = this;
          if (url && !this.__vidoraxTapped) {
            try {
              var tap = new TransformStream({
                transform: function(chunk, controller) {
                  rememberStreamChunk(url, chunk);
                  controller.enqueue(chunk);
                }
              });
              source = nativePipeThrough.call(this, tap);
              source.__vidoraxTapped = true;
            } catch (e7) {
              source = this;
            }
          }
          return _pipeTo.apply(source, arguments);
        };
        pipeToHooked.__vidoraxHooked = true;
        RS.pipeTo = pipeToHooked;
      }
      if (RS && typeof RS.tee === 'function' && !RS.tee.__vidoraxHooked) {
        var _tee = RS.tee;
        var teeHooked = function() {
          var branches = _tee.apply(this, arguments);
          try {
            if (branches && this.__vidoraxUrl) {
              for (var b = 0; b < branches.length; b++) branches[b].__vidoraxUrl = this.__vidoraxUrl;
            }
          } catch (e6) {}
          return branches;
        };
        teeHooked.__vidoraxHooked = true;
        RS.tee = teeHooked;
      }
      var RD = window.ReadableStreamDefaultReader && ReadableStreamDefaultReader.prototype;
      if (RD && typeof RD.read === 'function' && !RD.read.__vidoraxHooked) {
        var _read = RD.read;
        var readHooked = function() {
          var result = _read.apply(this, arguments);
          var url = this.__vidoraxUrl;
          if (!url || !result || typeof result.then !== 'function') return result;
          return result.then(function(r) {
            try { if (r && !r.done && r.value) rememberStreamChunk(url, r.value); } catch (e4) {}
            return r;
          });
        };
        readHooked.__vidoraxHooked = true;
        RD.read = readHooked;
      }
    } catch (e) {}
    // The whole file a ranged request reads (byte-range query parameters dropped), as split-tracks.ts wholeFileUrl.
    function fileOf(url) {
      try {
        var parsed = new URL(String(url));
        var names = ['bytestart', 'byteend', 'range', 'rn', 'rbuf'];
        var keys = [];
        parsed.searchParams.forEach(function(_v, k) { keys.push(k); });
        for (var i = 0; i < keys.length; i++) {
          if (names.indexOf(keys[i].toLowerCase()) >= 0) parsed.searchParams.delete(keys[i]);
        }
        parsed.hash = '';
        return parsed.toString();
      } catch (e) {
        return String(url);
      }
    }
    function chunkHolds(chunk, key) {
      var n = key.length;
      var first = key[0];
      var last = chunk.length - n;
      for (var i = 0; i <= last; i++) {
        if (chunk[i] !== first) continue;
        var j = 1;
        while (j < n && chunk[i + j] === key[j]) j++;
        if (j === n) return true;
      }
      return false;
    }
    // The streamed file the appended bytes were copied from: the one file (a byte range of it is the same file) whose
    // recent chunks hold them. The same bytes in two files name neither.
    function streamedFileOf(data) {
      try {
        var chunks = state.streamChunks;
        if (!chunks.length) return null;
        var isBuffer = typeof ArrayBuffer === 'function' && data instanceof ArrayBuffer;
        var total = data.byteLength;
        if (!(total >= MIN_STREAM_MATCH_BYTES)) return null;
        var size = Math.min(STREAM_MATCH_BYTES, total);
        var key = isBuffer ? new Uint8Array(data, 0, size) : new Uint8Array(data.buffer, data.byteOffset, size);
        var found = null;
        var foundFile = null;
        for (var i = chunks.length - 1; i >= 0; i--) {
          var c = chunks[i];
          if (!c.bytes.byteLength) continue;
          if (foundFile && fileOf(c.url) === foundFile) continue;
          if (chunkHolds(c.bytes, key)) {
            if (foundFile) return null;
            found = c.url;
            foundFile = fileOf(c.url);
          }
        }
        return found;
      } catch (e) {}
      return null;
    }
    try {
      if (window.URL && typeof URL.createObjectURL === 'function' && !URL.createObjectURL.__vidoraxHooked) {
        var _create = URL.createObjectURL;
        var createHooked = function(obj) {
          var blobUrl = _create.apply(this, arguments);
          try {
            var kind = objectUrlSourceKind(obj);
            if (kind) {
              var key = String(blobUrl).slice(0, 512);
              if (state.objectUrlKeys.length >= MAX_OBJECT_URLS) {
                var evicted = state.objectUrlKeys.shift();
                delete state.objectUrls[evicted];
                delete state.sourcesByUrl[evicted];
              }
              if (!state.objectUrls[key]) state.objectUrlKeys.push(key);
              state.objectUrls[key] = kind;
              if (kind === 'mse') state.sourcesByUrl[key] = obj;
              notify('object_url', { url: blobUrl, kind: kind });
            }
          } catch (e) {}
          return blobUrl;
        };
        createHooked.__vidoraxHooked = true;
        URL.createObjectURL = createHooked;
      }
    } catch (e) {}
    function hookAddSourceBuffer(Ctor) {
      try {
        if (!Ctor || !Ctor.prototype || typeof Ctor.prototype.addSourceBuffer !== 'function') return;
        if (Ctor.prototype.addSourceBuffer.__vidoraxHooked) return;
        var _add = Ctor.prototype.addSourceBuffer;
        var hooked = function(mime) {
          var buffer = _add.apply(this, arguments);
          try {
            var kind = sourceBufferTrackKind(mime);
            if (kind) {
              if (!this.__vidoraxTracks) {
                this.__vidoraxTracks = [];
                if (state.recent.length >= MAX_SOURCES) state.recent.shift();
                state.recent.push(this);
              }
              if (this.__vidoraxTracks.length < 8) this.__vidoraxTracks.push(kind);
              if (buffer) {
                buffer.__vidoraxKind = kind;
                buffer.__vidoraxSource = this;
              }
              notify('tracks', null);
            }
          } catch (e) {}
          return buffer;
        };
        hooked.__vidoraxHooked = true;
        Ctor.prototype.addSourceBuffer = hooked;
      } catch (e) {}
    }
    hookAddSourceBuffer(window.MediaSource);
    hookAddSourceBuffer(window.ManagedMediaSource);
    hookAddSourceBuffer(window.WebKitMediaSource);
    function recordSourceBufferFile(buffer, data) {
      try {
        if (!state.bufferUrls || !buffer || !buffer.__vidoraxKind || !data) return;
        var ms = buffer.__vidoraxSource;
        var kind = buffer.__vidoraxKind === 'a' ? 'a' : buffer.__vidoraxKind === 'v' ? 'v' : null;
        if (!ms || !kind) return;
        var url = state.bufferUrls.get(data.buffer || data);
        var streamed = false;
        if (!url && state.streamChunks.length) {
          // Bytes copied out of a streamed response: looked up in its chunks, often while the file is unknown, then
          // now and then (a recycled player's buffer fed the next item's file).
          var now = Date.now();
          var known = ms.__vidoraxFiles && ms.__vidoraxFiles[kind];
          if (now - (buffer.__vidoraxMatchedAt || 0) < (known ? STREAM_MATCH_KNOWN_MS : STREAM_MATCH_UNKNOWN_MS)) return;
          buffer.__vidoraxMatchedAt = now;
          url = streamedFileOf(data);
          streamed = true;
        }
        if (!url) return;
        if (!ms.__vidoraxFiles) ms.__vidoraxFiles = { v: null, a: null };
        var current = ms.__vidoraxFiles[kind];
        // Another byte range of the streamed file already named is the same file.
        if (current !== url && !(streamed && current && fileOf(current) === fileOf(url))) {
          ms.__vidoraxFiles[kind] = url;
          notify('files', null);
        }
      } catch (e) {}
    }
    function hookAppendBuffer(Ctor) {
      try {
        if (!Ctor || !Ctor.prototype || typeof Ctor.prototype.appendBuffer !== 'function') return;
        if (Ctor.prototype.appendBuffer.__vidoraxHooked) return;
        var _append = Ctor.prototype.appendBuffer;
        var hookedAppend = function(data) {
          recordSourceBufferFile(this, data);
          return _append.apply(this, arguments);
        };
        hookedAppend.__vidoraxHooked = true;
        Ctor.prototype.appendBuffer = hookedAppend;
      } catch (e) {}
    }
    hookAppendBuffer(window.SourceBuffer);
    hookAppendBuffer(window.ManagedSourceBuffer);
    try {
      if (navigator && typeof navigator.requestMediaKeySystemAccess === 'function' &&
          !navigator.requestMediaKeySystemAccess.__vidoraxHooked) {
        var _rmksa = navigator.requestMediaKeySystemAccess;
        var rmksaHooked = function() {
          try {
            state.emeRequested = true;
            notify('eme', null);
          } catch (e) {}
          return _rmksa.apply(navigator, arguments);
        };
        rmksaHooked.__vidoraxHooked = true;
        navigator.requestMediaKeySystemAccess = rmksaHooked;
      }
    } catch (e) {}
    return state;
  }
`;

/**
 * Build the injectable observer script.
 * Appended with `true;` so react-native-webview treats it as successful.
 */
export function buildMediaDetectionInjectedScript(): string {
  const batchMs = DETECTION_TIMING.mutationBatchMs;
  const maxBatch = DETECTION_TIMING.maxCandidatesPerBatch;
  const throttleMs = DETECTION_TIMING.bridgeThrottleMs;

  return `(function(){
  if (window.__VIDORAX_MEDIA_DETECTION__) { return true; }
  window.__VIDORAX_MEDIA_DETECTION__ = true;

  var CHANNEL = ${JSON.stringify(MEDIA_BRIDGE_CHANNEL)};
  var EXT_RE = /\\.(${VIDEO_EXTS}|${AUDIO_EXTS}|${STREAM_EXTS})(?:[?#]|$)/i;
  var MIME_HINTS = /^(video\\/|audio\\/|application\\/(vnd\\.apple\\.mpegurl|x-mpegurl|dash\\+xml))/i;
  var SEGMENT_RE = /(?:^|\\/)(?:seg(?:ment)?s?|chunk|frag(?:ment)?)(?:[_-]|\\.|\\/|$)|\\.(?:ts|m2ts|m4s)(?:[?#]|$)/i;
  var pending = [];
  var MAX_PENDING = ${maxBatch * 4};
  var seen = Object.create(null);
  var seenKeys = [];
  var MAX_SEEN = 320;
  var disposed = false;
  /** True once the page has negotiated encrypted media — protection evidence, never a bypass. */
  var emeRequested = false;
${MSE_OBSERVATION_SOURCE}
  // MediaSource observation — usually installed at document start by the before-content script (so a player built
  // while the page loads is seen), otherwise here. This script adopts its state.
  var mseObservation = vidoraxMseObservation();
  /** blob: url -> 'mse' | 'blob', bounded, so an indicator can say what kind of source it stands for. */
  var mseObjectUrls = mseObservation.objectUrls;
  // blob: URL -> the MediaSource behind it, so an element's SourceBuffer layout can be read (same bound).
  var mseSourcesByUrl = mseObservation.sourcesByUrl;
  // MediaSources seen through addSourceBuffer (newest last, bounded).
  var recentMediaSources = mseObservation.recent;
  if (mseObservation.emeRequested) emeRequested = true;
  /** True while this script's observers and listeners are live. */
  var attached = false;
  /**
   * True while the document is hidden: a parked tab (the app pauses its WebView), the Browser behind another screen,
   * or the app in the background. Nothing is observed or posted then; becoming visible rescans everything.
   */
  var suspended = false;
  var batchTimer = null;
  var lastFlushAt = 0;
  var pageUrl = location.href;
  var postCount = 0;
  var MAX_POSTS = 400;
  var POST_WINDOW_MS = 1000;
  var MAX_POSTS_PER_WINDOW = 28;
  var postWindowStart = 0;
  var postsInWindow = 0;

  /** Returns false when the caller's payload was NOT delivered, so it can be retried. */
  function post(type, payload) {
    try {
      if (disposed || suspended) return false;
      var now = Date.now();
      if (now - postWindowStart >= POST_WINDOW_MS) {
        postWindowStart = now;
        postsInWindow = 0;
        postCount = 0;
      }
      var priority = type === 'active_video' || type === 'active_iframe_player' ||
        type === 'blob_indicator' || type === 'page_meta' || type === 'ready' ||
        type === 'scan_complete';
      if (postsInWindow >= MAX_POSTS_PER_WINDOW && !priority) return false;
      if (postCount >= MAX_POSTS) return false;
      if (!window.ReactNativeWebView || !window.ReactNativeWebView.postMessage) {
        return false;
      }
      postsInWindow += 1;
      postCount += 1;
      window.ReactNativeWebView.postMessage(JSON.stringify({
        channel: CHANNEL,
        type: type,
        payload: payload,
        ts: Date.now()
      }));
      return true;
    } catch (e) { return false; }
  }

  function safeUrl(u) {
    if (!u || typeof u !== 'string') return null;
    var t = u.trim();
    if (!t) return null;
    var lower = t.toLowerCase();
    if (lower.indexOf('javascript:') === 0 || lower.indexOf('blob:') === 0 ||
        lower.indexOf('file:') === 0 || lower.indexOf('data:') === 0) {
      return null;
    }
    try {
      var abs = new URL(t, pageUrl).href;
      if (abs.indexOf('http://') !== 0 && abs.indexOf('https://') !== 0) return null;
      return abs;
    } catch (e) { return null; }
  }

  function isBlobUrl(u) {
    return typeof u === 'string' && u.trim().toLowerCase().indexOf('blob:') === 0;
  }

  function extOf(u) {
    try {
      var path = new URL(u).pathname;
      var m = path.match(/\\.([a-z0-9]+)$/i);
      return m ? m[1].toLowerCase() : null;
    } catch (e) { return null; }
  }

  function looksTikTokCdnMedia(u) {
    try {
      var parsed = new URL(u);
      var h = (parsed.hostname || '').toLowerCase();
      if (h.indexOf('ibyteimg') >= 0) return false;
      var p = (parsed.pathname || '').toLowerCase();
      if (/\\.(jpg|jpeg|png|webp|gif|js|css|json|html|m4s|ts)$/i.test(p)) return false;
      var cdn = h.indexOf('tiktokcdn') >= 0 || h.indexOf('tiktokv.com') >= 0 ||
        h.indexOf('muscdn.com') >= 0 || h.indexOf('byteoversea.com') >= 0;
      var tos = p.indexOf('/tos') >= 0 || p.indexOf('/video/') >= 0 ||
        p.indexOf('/aweme/') >= 0 || p.indexOf('/obj/') >= 0;
      if (cdn && tos) return true;
      if ((h === 'tiktok.com' || h.slice(-11) === '.tiktok.com') && p.indexOf('/video/tos') >= 0) return true;
      return false;
    } catch (e) { return false; }
  }

  function looksInstagramCdnMedia(u) {
    try {
      var parsed = new URL(u);
      var h = (parsed.hostname || '').toLowerCase();
      var p = (parsed.pathname || '').toLowerCase();
      if (/\\.(jpg|jpeg|png|webp|gif|js|css|json|html|m4s|ts)$/i.test(p)) return false;
      var ig = h.indexOf('cdninstagram') >= 0 || h.indexOf('fbcdn.net') >= 0 ||
        h.indexOf('scontent') >= 0;
      if (!ig) return false;
      if (p.indexOf('/v/t') >= 0 || /\\.(mp4|m4v|webm|mov)(?:$|[/?])/i.test(p)) return true;
      return false;
    } catch (e) { return false; }
  }

  function looksPlaybackQuery(u) {
    try {
      var s = String(u);
      if (/[?&](?:mime|content[_-]?type)=(video|audio|application(?:%2F|\\/)(?:vnd\\.apple\\.mpegurl|x-mpegurl|dash\\+xml))/i.test(s)) {
        return true;
      }
      if (/[?&](?:ext|format|container|file)=(mp4|webm|m3u8|mpd|mov|m4v|mkv|mp3|m4a|aac)(?:&|$)/i.test(s)) {
        return true;
      }
      if (/[?&]itag=\\d+/i.test(s) && /[?&](?:clen|dur|bitrate|mime)=/i.test(s)) return true;
      return false;
    } catch (e) { return false; }
  }

  function canonicalizePlaybackUrl(u) {
    try {
      var parsed = new URL(u);
      var p = (parsed.pathname || '').toLowerCase();
      if (p.indexOf('/videoplayback') < 0) return u;
      var keys = ['range', 'rn', 'rbuf', 'alr', 'ump', 'keepalive'];
      var changed = false;
      for (var i = 0; i < keys.length; i++) {
        if (parsed.searchParams.has(keys[i])) {
          parsed.searchParams.delete(keys[i]);
          changed = true;
        }
      }
      return changed ? parsed.toString() : u;
    } catch (e) { return u; }
  }

  function looksGenericMediaPath(u) {
    try {
      var p = new URL(u).pathname.toLowerCase();
      if (SEGMENT_RE.test(u) && !/\\.m3u8(?:[?#]|$)/i.test(u) && !/\\.mpd(?:[?#]|$)/i.test(u)) {
        return false;
      }
      if (/(?:^|\\/)(?:videoplayback|dashplaylist)(?:[\\/._-]|$)/i.test(p)) return true;
      if (/(?:^|\\/)v\\/t\\d{2,}(?:[\\/._-]|$)/i.test(p)) return true;
      return /(?:^|\\/)(?:hls|m3u8|manifest|playlist|stream(?:ing)?|vod)(?:[\\/._-]|$)/i.test(p);
    } catch (e) { return false; }
  }

  function looksMedia(u, mime, initiator) {
    if (mime && MIME_HINTS.test(mime)) return true;
    if (SEGMENT_RE.test(u) && !/\\.m3u8(?:[?#]|$)/i.test(u) && !/\\.mpd(?:[?#]|$)/i.test(u)) {
      return false;
    }
    if (EXT_RE.test(u)) return true;
    if (looksGenericMediaPath(u)) return true;
    if (looksPlaybackQuery(u)) return true;
    var init = initiator ? String(initiator).toLowerCase() : '';
    if ((init === 'video' || init === 'audio' || init === 'media') &&
        !/\\.(js|css|png|jpe?g|gif|webp|svg|json|html?|xml|woff2?|ttf|ico)(?:[?#]|$)/i.test(u)) {
      return true;
    }
    return looksTikTokCdnMedia(u) || looksInstagramCdnMedia(u);
  }

  function enqueue(candidate) {
    if (disposed || suspended || !candidate || !candidate.url) return;
    candidate.url = canonicalizePlaybackUrl(candidate.url);
    if (isBlobUrl(candidate.url)) {
      postBlobIndicator(candidate.url, null, null);
      return;
    }
    var key = candidate.url + '|' + (candidate.mimeType || '') + '|' +
      (candidate.ownerElementIdentity || '') + '|' + String(candidate.width) + '|' + String(candidate.height);
    if (seen[key]) return;
    seen[key] = 1;
    seenKeys.push(key);
    if (seenKeys.length > MAX_SEEN) delete seen[seenKeys.shift()];
    pending.push(candidate);
    // Bounded backlog: a pathological page can keep producing, but the newest evidence — the video the
    // user is looking at — must never be dropped for the oldest.
    while (pending.length > MAX_PENDING) pending.shift();
    if (pending.length >= ${maxBatch}) {
      flush();
      return;
    }
    scheduleFlush();
  }

  function scheduleFlush() {
    if (disposed || suspended || batchTimer || !pending.length) return;
    var delay = ${batchMs};
    var since = Date.now() - lastFlushAt;
    if (since < ${throttleMs}) delay = Math.max(delay, ${throttleMs} - since);
    batchTimer = setTimeout(flush, delay);
  }

  /**
   * Sends at most one batch per call, keeping the Phase 10 caps. Whatever does not fit, or is refused by
   * the post throttle, stays queued and is re-armed — a candidate is deduped by 'seen' and would never be
   * produced a second time, so dropping it here loses it for the life of the page.
   */
  function flush() {
    if (batchTimer) { clearTimeout(batchTimer); batchTimer = null; }
    if (!pending.length) return;
    var batch = pending.slice(0, ${maxBatch});
    var rest = pending.slice(${maxBatch});
    lastFlushAt = Date.now();
    if (post('mutation_batch', { candidates: batch, pageUrl: pageUrl })) {
      pending = rest;
    }
    scheduleFlush();
  }

  function readMeta() {
    function meta(sel, attr) {
      var el = document.querySelector(sel);
      if (!el) return null;
      var v = attr ? el.getAttribute(attr) : (el.textContent || '');
      return v && String(v).trim() ? String(v).trim() : null;
    }
    post('page_meta', {
      pageUrl: pageUrl,
      title: document.title || null,
      description: meta('meta[name="description"]', 'content'),
      ogImage: meta('meta[property="og:image"]', 'content'),
      ogVideo: meta('meta[property="og:video"]', 'content') ||
               meta('meta[property="og:video:url"]', 'content') ||
               meta('meta[property="og:video:secure_url"]', 'content') ||
               meta('meta[name="twitter:player:stream"]', 'content'),
      canonicalUrl: meta('link[rel="canonical"]', 'href')
    });
    var ogVideo = meta('meta[property="og:video"]', 'content') ||
                  meta('meta[property="og:video:url"]', 'content') ||
                  meta('meta[property="og:video:secure_url"]', 'content') ||
                  meta('meta[name="twitter:player:stream"]', 'content');
    if (isBlobUrl(ogVideo)) {
      postBlobIndicator(ogVideo, null, null);
    } else {
      var ogAbs = safeUrl(ogVideo);
      if (ogAbs && looksMedia(ogAbs, null)) {
        enqueue({
          url: ogAbs,
          pageUrl: pageUrl,
          mimeType: null,
          extension: extOf(ogAbs),
          title: document.title || null,
          thumbnailUrl: safeUrl(meta('meta[property="og:image"]', 'content')),
          duration: null,
          width: null,
          height: null,
          estimatedFileSize: null,
          isLive: false,
          isDrm: false,
          playlistType: null,
          detectionSource: 'og_meta',
          tagName: 'meta'
        });
      }
    }
    try {
      var preloads = document.querySelectorAll('link[rel="preload"][as="video"],link[rel="preload"][as="fetch"]');
      for (var pi = 0; pi < preloads.length && pi < 12; pi++) {
        var href = preloads[pi].getAttribute('href');
        var pAbs = safeUrl(href);
        var pType = preloads[pi].getAttribute('type');
        if (pAbs && looksMedia(pAbs, pType)) {
          enqueue({
            url: pAbs,
            pageUrl: pageUrl,
            mimeType: pType || null,
            extension: extOf(pAbs),
            title: document.title || null,
            thumbnailUrl: null,
            duration: null,
            width: null,
            height: null,
            estimatedFileSize: null,
            isLive: false,
            isDrm: false,
            playlistType: null,
            detectionSource: 'og_meta',
            tagName: 'link'
          });
        }
      }
    } catch (ePre) {}
  }

  function unescapeMediaUrl(raw) {
    if (!raw || typeof raw !== 'string') return raw;
    return raw.replace(/\\u0026/gi, '&').replace(/\\\//g, '/').replace(/&amp;/g, '&');
  }

  function harvestJsonLd() {
    try {
      var nodes = document.querySelectorAll('script[type="application/ld+json"]');
      var limit = Math.min(nodes.length, 12);
      for (var i = 0; i < limit; i++) {
        var txt = nodes[i].textContent || '';
        if (txt.length < 20 || txt.length > 200000) continue;
        var data = null;
        try { data = JSON.parse(txt); } catch (eParse) { continue; }
        var stack = Array.isArray(data) ? data.slice() : [data];
        var guard = 0;
        while (stack.length && guard < 40) {
          guard += 1;
          var node = stack.pop();
          if (!node || typeof node !== 'object') continue;
          if (Array.isArray(node)) {
            for (var ai = 0; ai < node.length && ai < 20; ai++) stack.push(node[ai]);
            continue;
          }
          var type = String(node['@type'] || node.type || '');
          var content = node.contentUrl || node.contentURL || node.embedUrl || node.embedURL;
          if (content && (type.toLowerCase().indexOf('video') >= 0 || looksMedia(String(content), node.encodingFormat || null))) {
            var abs = safeUrl(unescapeMediaUrl(String(content)));
            if (abs && looksMedia(abs, node.encodingFormat || null)) {
              enqueue({
                url: abs,
                pageUrl: pageUrl,
                mimeType: node.encodingFormat || null,
                extension: extOf(abs),
                title: node.name || document.title || null,
                thumbnailUrl: safeUrl(node.thumbnailUrl || (node.thumbnail && node.thumbnail.url) || null),
                duration: null,
                width: null,
                height: null,
                estimatedFileSize: null,
                isLive: false,
                isDrm: false,
                playlistType: null,
                detectionSource: 'og_meta',
                tagName: 'script'
              });
            }
          }
          if (node['@graph']) stack.push(node['@graph']);
        }
      }
    } catch (eLd) {}
  }

  function harvestEmbeddedJsonUrls() {
    try {
      var keyRe = /"(contentUrl|playable_url(?:_quality_hd)?|browser_native_(?:hd|sd)_url|hd_src(?:_no_ratelimit)?|sd_src(?:_no_ratelimit)?|playbackUrl|hls_url|dash_url|fallback_url|video_url|file)"\\s*:\\s*"(https:[^"]+)"/gi;
      var scripts = document.getElementsByTagName('script');
      var limit = Math.min(scripts.length, 28);
      var found = 0;
      for (var i = 0; i < limit && found < 12; i++) {
        var t = scripts[i].textContent || '';
        if (t.length < 40 || t.length > 350000) continue;
        if (t.indexOf('http') < 0) continue;
        keyRe.lastIndex = 0;
        var m;
        while ((m = keyRe.exec(t)) && found < 12) {
          var raw = unescapeMediaUrl(m[2]);
          observeNetworkUrl(raw, null, 'og_meta');
          found += 1;
        }
      }
    } catch (eJson) {}
  }

  function harvestEmbeddedMedia() {
    harvestJsonLd();
    harvestEmbeddedJsonUrls();
  }

  /**
   * Encrypted-playback evidence, observed only. Never touches a key system, a license or a session —
   * a page that negotiates EME, an element that has MediaKeys, or an 'encrypted' event is enough to
   * know the stream is protected and must not be offered.
   */
  function isProtectedElement(el) {
    try {
      if (el && (el.mediaKeys || el.__vidoraxEncrypted)) return true;
    } catch (e) {}
    return emeRequested;
  }

  function postBlobIndicator(rawUrl, el, sourceKind) {
    post('blob_indicator', {
      pageUrl: pageUrl,
      blobUrl: String(rawUrl).slice(0, 512),
      elementIdentity: el && (el.tagName || '').toLowerCase() === 'video' ? ensureVideoIdentity(el) : null,
      isProtected: isProtectedElement(el),
      sourceKind: sourceKind || (el && (mseObjectUrls[String(rawUrl).slice(0, 512)] || mediaSourceFor(el, rawUrl)) ? 'mse' : 'blob'),
      mseTracks: mseTrackLayoutOf(el, rawUrl),
      mseFiles: mseFilesOf(el, rawUrl)
    });
  }

  /**
   * The resource a media element holds right now. Chromium keeps currentSrc after a page removes the src and calls
   * load() (a recycled feed player between items), so an element with no resource (NETWORK_EMPTY / NO_SOURCE) reports
   * only a src it was just given, never the one it played before.
   */
  function currentSourceOf(el) {
    try {
      var ns = el.networkState;
      if (ns === 0 || ns === 3) {
        var assigned = el.getAttribute('src');
        return assigned ? (el.src || assigned) : '';
      }
      return el.currentSrc || el.src || el.getAttribute('src') || '';
    } catch (e) { return ''; }
  }

  function mediaFromElement(el, source) {
    if (!el) return;
    var tag = (el.tagName || '').toLowerCase();
    var rawSrc = tag === 'video' || tag === 'audio' ? currentSourceOf(el) : (el.src || el.getAttribute('src'));
    if (isBlobUrl(rawSrc)) {
      // A blob is never downloadable. It is reported as evidence of a player whose real HTTP(S)
      // source has to be found through network observation instead.
      postBlobIndicator(rawSrc, el, null);
      return;
    }
    var url = safeUrl(rawSrc);
    var mime = el.getAttribute('type') || null;
    if (!url) return;
    var owner = tag === 'source' ? el.parentElement : el;
    var ownerTag = owner && (owner.tagName || '').toLowerCase();
    if (!looksMedia(url, mime, ownerTag)) return;

    var width = null;
    var height = null;
    var duration = null;
    try {
      if (typeof el.videoWidth === 'number' && el.videoWidth > 0) width = el.videoWidth;
      if (typeof el.videoHeight === 'number' && el.videoHeight > 0) height = el.videoHeight;
      if (typeof el.duration === 'number' && isFinite(el.duration) && el.duration > 0) {
        duration = el.duration;
      }
    } catch (e) {}

    var drm = false;
    try {
      drm = !!(owner && (owner.mediaKeys || owner.__vidoraxEncrypted));
    } catch (e) {}

    enqueue({
      url: url,
      pageUrl: pageUrl,
      mimeType: mime,
      extension: extOf(url),
      title: document.title || null,
      thumbnailUrl: safeUrl(el.getAttribute('poster')),
      duration: duration,
      width: width,
      height: height,
      estimatedFileSize: null,
      isLive: false,
      isDrm: drm,
      playlistType: null,
      detectionSource: source,
      tagName: tag,
      ownerElementIdentity: ownerTag === 'video' ? ensureVideoIdentity(owner) : null,
      frameUrl: el.ownerDocument && el.ownerDocument.URL || pageUrl
    });
  }

  function scanDocument(doc) {
    if (!doc || !doc.querySelectorAll) return;
    var videos = doc.querySelectorAll('video');
    for (var i = 0; i < videos.length; i++) {
      mediaFromElement(videos[i], 'dom_video');
      var sources = videos[i].querySelectorAll('source');
      for (var s = 0; s < sources.length; s++) {
        mediaFromElement(sources[s], 'dom_source');
      }
    }
    var audios = doc.querySelectorAll('audio');
    for (var a = 0; a < audios.length; a++) {
      mediaFromElement(audios[a], 'dom_audio');
      var aSources = audios[a].querySelectorAll('source');
      for (var as = 0; as < aSources.length; as++) {
        mediaFromElement(aSources[as], 'dom_source');
      }
    }
  }

  /**
   * Same-origin subframe documents the top document may legally read. A cross-origin frame throws here and
   * is skipped — its media is only ever seen by native request observation. Bounded by MAX_TRACKED_IFRAMES.
   */
  function sameOriginFrameDocuments() {
    var docs = [];
    try {
      var frames = document.querySelectorAll('iframe');
      var limit = Math.min(frames.length, MAX_TRACKED_IFRAMES);
      for (var f = 0; f < limit; f++) {
        try {
          var doc = frames[f].contentDocument ||
            (frames[f].contentWindow && frames[f].contentWindow.document);
          if (doc && doc.querySelectorAll) docs.push(doc);
        } catch (cross) {}
      }
    } catch (e) {}
    return docs;
  }

  function scanDom() {
    pageUrl = location.href;
    scanDocument(document);
    var frameDocs = sameOriginFrameDocuments();
    for (var i = 0; i < frameDocs.length; i++) {
      // Media events inside a subframe never reach the top document, so each one needs its own listeners.
      attachMediaListeners(frameDocs[i]);
      scanDocument(frameDocs[i]);
    }
  }

  function observePerfEntry(e) {
    try {
      var name = e && e.name ? String(e.name) : '';
      if (isBlobUrl(name)) {
        postBlobIndicator(name, null, null);
        return;
      }
      var abs = safeUrl(name);
      var initiator = e && e.initiatorType ? String(e.initiatorType) : '';
      if (!abs || !looksMedia(abs, null, initiator)) return;
      enqueue({
        url: abs,
        pageUrl: pageUrl,
        mimeType: null,
        extension: extOf(abs),
        title: document.title || null,
        thumbnailUrl: null,
        duration: null,
        width: null,
        height: null,
        estimatedFileSize: null,
        isLive: false,
        isDrm: false,
        playlistType: null,
        detectionSource: 'performance_resource',
        tagName: null
      });
    } catch (err) {}
  }

  function observeNetworkUrl(rawUrl, mime, source) {
    try {
      if (isBlobUrl(rawUrl)) {
        postBlobIndicator(rawUrl, null, null);
        return;
      }
      var abs = safeUrl(rawUrl);
      if (!abs || !looksMedia(abs, mime)) return;
      enqueue({
        url: abs,
        pageUrl: pageUrl,
        mimeType: mime || null,
        extension: extOf(abs),
        title: document.title || null,
        thumbnailUrl: null,
        duration: null,
        width: null,
        height: null,
        estimatedFileSize: null,
        isLive: false,
        isDrm: false,
        playlistType: null,
        detectionSource: source,
        tagName: null
      });
    } catch (e) {}
  }

  // fetch hook — capture request URL + response Content-Type when readable.
  try {
    if (window.fetch) {
      var _fetch = window.fetch;
      window.fetch = function() {
        var input = arguments[0];
        var reqUrl = null;
        try {
          if (typeof input === 'string') reqUrl = input;
          else if (input && input.url) reqUrl = String(input.url);
        } catch (e) {}
        return _fetch.apply(this, arguments).then(function(res) {
          try {
            var ct = null;
            try { ct = res.headers && res.headers.get ? res.headers.get('content-type') : null; } catch (e2) {}
            var finalUrl = res.url || reqUrl;
            observeNetworkUrl(finalUrl, ct, 'js_fetch');
            if (reqUrl && reqUrl !== finalUrl) observeNetworkUrl(reqUrl, ct, 'js_fetch');
          } catch (e3) {}
          return res;
        });
      };
    }
  } catch (e) {}

  // XHR hook
  try {
    var XO = XMLHttpRequest.prototype.open;
    var XS = XMLHttpRequest.prototype.send;
    XMLHttpRequest.prototype.open = function(method, url) {
      try { this.__vidoraxUrl = url; } catch (e) {}
      return XO.apply(this, arguments);
    };
    XMLHttpRequest.prototype.send = function() {
      var xhr = this;
      try {
        xhr.addEventListener('load', function() {
          try {
            var ct = null;
            try { ct = xhr.getResponseHeader('content-type'); } catch (e) {}
            observeNetworkUrl(xhr.responseURL || xhr.__vidoraxUrl, ct, 'js_xhr');
          } catch (e2) {}
        }, { once: true });
      } catch (e3) {}
      return XS.apply(this, arguments);
    };
  } catch (e) {}

  // Page-side MediaSource events from the shared observation: a new media blob URL is reported as an indicator (never a
  // download target); SourceBuffer layout, appended files and EME negotiation re-report the active video.
  mseObservation.listener = function(event, detail) {
    try {
      if (event === 'object_url') {
        postBlobIndicator(detail.url, null, detail.kind);
        return;
      }
      if (event === 'eme') emeRequested = true;
      scheduleActiveVideo();
    } catch (e) {}
  };

  // The MediaSource an element plays. Mapped from its blob: URL when createObjectURL was observed; otherwise (the page
  // created it before this script ran) the only attached one, or the attached one whose duration is the element's.
  function mediaSourceFor(el, src) {
    try {
      var ms = mseSourcesByUrl[String(src).slice(0, 512)];
      if (ms) return ms;
      var open = [];
      for (var i = 0; i < recentMediaSources.length; i++) {
        if (recentMediaSources[i].readyState !== 'closed') open.push(recentMediaSources[i]);
      }
      if (open.length === 1) return open[0];
      var d = el && typeof el.duration === 'number' ? el.duration : NaN;
      if (!isFinite(d)) return null;
      var match = null;
      for (var j = 0; j < open.length; j++) {
        if (open[j].duration === d) {
          if (match) return null;
          match = open[j];
        }
      }
      return match;
    } catch (e) {}
    return null;
  }
  // The files feeding an element's MediaSource, per track: { video, audio } (the latest appended of each), or null.
  function mseFilesOf(el, src) {
    try {
      var ms = mediaSourceFor(el, src);
      var files = ms && ms.__vidoraxFiles;
      if (!files || (!files.v && !files.a)) return null;
      return { video: files.v || null, audio: files.a || null };
    } catch (e) {}
    return null;
  }
  function mseTrackLayoutOf(el, src) {
    try {
      var ms = mediaSourceFor(el, src);
      var kinds = ms && ms.__vidoraxTracks;
      if (!kinds || !kinds.length) return null;
      var v = false, a = false, av = false;
      for (var i = 0; i < kinds.length; i++) {
        if (kinds[i] === 'av') av = true; else if (kinds[i] === 'v') v = true; else if (kinds[i] === 'a') a = true;
      }
      if (av) return 'muxed';
      if (v && a) return 'split';
      if (v) return 'video';
      if (a) return 'audio';
    } catch (e) {}
    return null;
  }
  // Attaching MediaKeys to an element is protection evidence for that element. Pages that negotiated EME before this
  // script was injected still attach their keys afterwards (the negotiation is asynchronous), so the player is
  // re-reported once they are attached. Observation only: the original is called and its promise returned untouched.
  try {
    var MediaEl = window.HTMLMediaElement;
    if (MediaEl && MediaEl.prototype && typeof MediaEl.prototype.setMediaKeys === 'function' &&
        !MediaEl.prototype.setMediaKeys.__vidoraxHooked) {
      var _setKeys = MediaEl.prototype.setMediaKeys;
      var hookedSetKeys = function(keys) {
        var el = this;
        var result = _setKeys.apply(this, arguments);
        try {
          if (keys) {
            var mark = function() {
              try { el.__vidoraxEncrypted = true; scheduleActiveVideo(); } catch (e2) {}
            };
            if (result && typeof result.then === 'function') result.then(mark, function() {});
            else mark();
          }
        } catch (e) {}
        return result;
      };
      hookedSetKeys.__vidoraxHooked = true;
      MediaEl.prototype.setMediaKeys = hookedSetKeys;
    }
  } catch (e) {}

  var scanTimer = null;
  function scheduleScanDom() {
    if (disposed || suspended || scanTimer) return;
    scanTimer = setTimeout(function() {
      scanTimer = null;
      scanDom();
    }, ${batchMs});
  }

  var mo = null;
  var po = null;

  function onLoadedMetadata(ev) {
    var t = ev.target;
    if (!t) return;
    var tag = (t.tagName || '').toLowerCase();
    if (tag === 'video') mediaFromElement(t, 'dom_video');
    if (tag === 'audio') mediaFromElement(t, 'dom_audio');
  }

  /**
   * The rest of the resource-selection lifecycle. A player that swaps its source through <source>
   * selection or a property assignment produces no attribute mutation and may never re-fire
   * loadedmetadata — loadstart / durationchange / canplay are then the only notice that the element
   * now points at a different resource. All of them land in the same deduped, batched enqueue path.
   */
  function onMediaResourceEvent(ev) {
    try {
      var t = ev && ev.target;
      if (!t) return;
      var tag = (t.tagName || '').toLowerCase();
      if (tag !== 'video' && tag !== 'audio') return;
      mediaFromElement(t, tag === 'video' ? 'dom_video' : 'dom_audio');
      if (tag === 'video') scheduleActiveVideo();
    } catch (e) {}
  }

  var MEDIA_EVENTS = [
    ['loadedmetadata', onLoadedMetadata],
    ['loadstart', onMediaResourceEvent],
    ['durationchange', onMediaResourceEvent],
    ['canplay', onMediaResourceEvent],
    ['play', markRecentPlay],
    ['playing', markRecentPlay],
    ['loadeddata', markRecentPlay],
    ['pause', onPause],
    ['encrypted', onEncrypted]
  ];
  /** Documents already wired, so a rescan never registers a second set of listeners. */
  var listenerDocs = [];
  var MAX_LISTENER_DOCS = 12;

  function attachMediaListeners(doc) {
    try {
      if (!doc || !doc.addEventListener) return;
      for (var d = 0; d < listenerDocs.length; d++) {
        if (listenerDocs[d] === doc) return;
      }
      if (listenerDocs.length >= MAX_LISTENER_DOCS) return;
      for (var i = 0; i < MEDIA_EVENTS.length; i++) {
        doc.addEventListener(MEDIA_EVENTS[i][0], MEDIA_EVENTS[i][1], true);
      }
      listenerDocs.push(doc);
    } catch (e) {}
  }

  function detachMediaListeners() {
    for (var d = 0; d < listenerDocs.length; d++) {
      for (var i = 0; i < MEDIA_EVENTS.length; i++) {
        try {
          listenerDocs[d].removeEventListener(MEDIA_EVENTS[i][0], MEDIA_EVENTS[i][1], true);
        } catch (e) {}
      }
    }
    listenerDocs = [];
  }

  // --- Phase 4A: bounded active/visible video evidence (no DOM dump, no timeupdate flood) ---
  var videoSeq = 0;
  var trackedVideos = typeof WeakMap !== 'undefined' ? new WeakMap() : null;
  var intersectionByEl = typeof WeakMap !== 'undefined' ? new WeakMap() : null;
  var recentPlayUntil = typeof WeakMap !== 'undefined' ? new WeakMap() : null;
  var io = null;
  var activeVideoTimer = null;
  var lastActiveVideoKey = '';
  var MAX_TRACKED_VIDEOS = 12;
  var MAX_TRACKED_IFRAMES = 8;
  var iframeSeq = 0;
  var trackedIframes = typeof WeakMap !== 'undefined' ? new WeakMap() : null;

  function ensureIframeIdentity(el) {
    try {
      if (trackedIframes && trackedIframes.has(el)) return trackedIframes.get(el);
      iframeSeq += 1;
      var id = 'f' + iframeSeq;
      if (trackedIframes) trackedIframes.set(el, id);
      return id;
    } catch (e) { return 'f0'; }
  }

  function collectVideoElements() {
    var out = [];
    try {
      var videos = document.querySelectorAll('video');
      var limit = Math.min(videos.length, MAX_TRACKED_VIDEOS);
      for (var i = 0; i < limit; i++) out.push(videos[i]);
    } catch (e) {}
    try {
      var iframes = document.querySelectorAll('iframe');
      var maxFrames = Math.min(iframes.length, MAX_TRACKED_IFRAMES);
      for (var f = 0; f < maxFrames && out.length < MAX_TRACKED_VIDEOS; f++) {
        try {
          var doc = iframes[f].contentDocument || (iframes[f].contentWindow && iframes[f].contentWindow.document);
          if (!doc || !doc.querySelectorAll) continue;
          var inner = doc.querySelectorAll('video');
          for (var v = 0; v < inner.length && out.length < MAX_TRACKED_VIDEOS; v++) {
            out.push(inner[v]);
          }
        } catch (cross) {}
      }
    } catch (e2) {}
    return out;
  }

  function playerSrcLooksMedia(src) {
    if (!src || typeof src !== 'string') return false;
    var lower = String(src).toLowerCase();
    if (lower.indexOf('googleads') >= 0 || lower.indexOf('doubleclick') >= 0 ||
        lower.indexOf('googlesyndication') >= 0 || lower.indexOf('about:blank') >= 0 ||
        lower.indexOf('javascript:') === 0) {
      return false;
    }
    if (/\\/(?:embed|player|video|media|watch)\\/[A-Za-z0-9_.-]+/.test(lower)) return true;
    if (/(?:^|\\.)(?:player|embed)\\./.test(lower)) return true;
    return false;
  }

  function looksLikePlayerIframe(el) {
    try {
      if (!isElementDisplayed(el)) return false;
      var r = el.getBoundingClientRect();
      var w = r && r.width ? r.width : 0;
      var h = r && r.height ? r.height : 0;
      var area = w * h;
      if (w < 140 || h < 80 || area < 20000) return false;
      var src = '';
      try { src = el.src || el.getAttribute('src') || ''; } catch (e) {}
      var allow = '';
      try { allow = String(el.getAttribute('allow') || '').toLowerCase(); } catch (e2) {}
      var allowFs = false;
      try {
        allowFs = !!(el.allowFullscreen || el.hasAttribute('allowfullscreen') ||
          el.getAttribute('allowfullscreen') != null);
      } catch (e3) {}
      if (playerSrcLooksMedia(src)) return true;
      var allowMedia = allow.indexOf('autoplay') >= 0 ||
        allow.indexOf('encrypted-media') >= 0 || allow.indexOf('fullscreen') >= 0;
      return (allowFs || allowMedia) && area >= 40000;
    } catch (e) { return false; }
  }

  function iframeFrameClass(el) {
    try {
      var doc = el.contentDocument || (el.contentWindow && el.contentWindow.document);
      if (doc) return 'same-origin';
    } catch (e) {}
    return 'cross-origin';
  }

  function sameOriginVideoCount(el) {
    try {
      var doc = el.contentDocument || (el.contentWindow && el.contentWindow.document);
      if (!doc || !doc.querySelectorAll) return 0;
      return doc.querySelectorAll('video').length;
    } catch (e) { return null; }
  }

  function sanitizeIframeSrc(raw) {
    try {
      if (!raw || typeof raw !== 'string') return null;
      var abs = safeUrl(raw);
      if (!abs) return null;
      var parsed = new URL(abs);
      return parsed.origin + parsed.pathname;
    } catch (e) { return null; }
  }

  function ensureVideoIdentity(el) {
    try {
      if (trackedVideos && trackedVideos.has(el)) return trackedVideos.get(el);
      videoSeq += 1;
      var id = 'v' + videoSeq;
      if (trackedVideos) trackedVideos.set(el, id);
      return id;
    } catch (e) { return 'v0'; }
  }

  /**
   * True once an ancestor also holds another player: a feed/list container. Its labels, text and links describe the
   * neighbouring posts too (a "Sponsored" post, another item's link), so nothing above it speaks for this element.
   */
  function isSharedMediaContainer(node, el) {
    try {
      if (node === el || !node.querySelectorAll) return false;
      var players = node.querySelectorAll('video,iframe');
      for (var i = 0; i < players.length && i < 64; i++) {
        if (players[i] !== el) return true;
      }
    } catch (e) {}
    return false;
  }

  function readAssociatedContentId(el, skipLocation) {
    try {
      var node = el;
      for (var depth = 0; depth < 16 && node; depth++) {
        if (isSharedMediaContainer(node, el)) break;
        if (node.getAttribute) {
          var attrs = ['data-id', 'data-media-id', 'data-video-id', 'data-item-id', 'data-e2e-vid', 'data-shortcode'];
          for (var ai = 0; ai < attrs.length; ai++) {
            var val = node.getAttribute(attrs[ai]);
            if (val && /^[A-Za-z0-9_-]{5,32}$/.test(String(val))) {
              return String(val).slice(0, 32);
            }
          }
        }
        if (node.tagName === 'A' && node.href) {
          var selfHm = String(node.href).match(/\\/(?:reel|p)\\/([A-Za-z0-9_-]{5,32})/i) ||
            String(node.href).match(/\\/(?:video|watch|embed|media)\\/([A-Za-z0-9_-]{5,32})/i);
          if (selfHm && selfHm[1]) return String(selfHm[1]).slice(0, 32);
        }
        if (node.querySelector) {
          var link = node.querySelector('a[href*="/reel/"],a[href*="/p/"],a[href*="/video/"]');
          if (link && link.href) {
            var hm = String(link.href).match(/\\/(?:reel|p)\\/([A-Za-z0-9_-]{5,32})/i) ||
                     String(link.href).match(/\\/(?:video|watch|embed|media)\\/([A-Za-z0-9_-]{5,32})/i);
            if (hm && hm[1]) return String(hm[1]).slice(0, 32);
          }
        }
        node = node.parentElement;
      }
      if (skipLocation) return null;
      var overlaid = readOverlaidContentId(el);
      if (overlaid) return overlaid;
      try {
        var locHm = String(location.href).match(/\\/(?:video|watch|embed|media)\\/([A-Za-z0-9_-]{5,32})/i);
        if (locHm && locHm[1]) return String(locHm[1]).slice(0, 32);
      } catch (eLoc) {}
    } catch (e) {}
    return null;
  }

  var CONTENT_ID_ATTRS = ['data-id', 'data-media-id', 'data-video-id', 'data-item-id', 'data-e2e-vid', 'data-shortcode'];
  var CONTENT_LINK_RE = /\\/(?:reel|reels|p|video|videos|watch|embed|media|shorts)\\/([A-Za-z0-9_-]{5,32})/i;

  /** The distinct content ids one DOM subtree names (its id attributes, its links); stops counting past two. */
  function contentIdsWithin(node) {
    var found = { id: null, count: 0 };
    function add(value) {
      if (!value || value === found.id) return;
      if (found.id && found.count >= 1) { found.count = 2; return; }
      found.id = value;
      found.count = 1;
    }
    try {
      if (node.getAttribute) {
        for (var ai = 0; ai < CONTENT_ID_ATTRS.length; ai++) {
          var val = node.getAttribute(CONTENT_ID_ATTRS[ai]);
          if (val && /^[A-Za-z0-9_-]{5,32}$/.test(String(val))) add(String(val).slice(0, 32));
        }
      }
      var links = node.querySelectorAll ? node.querySelectorAll('a[href]') : [];
      if (node.tagName === 'A') links = [node].concat(Array.prototype.slice.call(links, 0, 47));
      for (var li = 0; li < links.length && li < 48 && found.count < 2; li++) {
        var hm = String(links[li].href || '').match(CONTENT_LINK_RE);
        if (hm && hm[1]) add(String(hm[1]).slice(0, 32));
      }
    } catch (e) {}
    return found;
  }

  /**
   * The feed item a player is laid over, for a player that lives outside every item (one shared player the page moves
   * over the card in view, a floating overlay). Only what is painted beneath the player counts — its own controls and
   * captions are above it — and only the smallest block there that names exactly one item: a block naming two is the
   * feed itself, and an ancestor of the player is the whole page.
   */
  function readOverlaidContentId(el) {
    try {
      if (!document.elementsFromPoint || !el.getBoundingClientRect) return null;
      var r = el.getBoundingClientRect();
      if (!r || r.width < 80 || r.height < 80) return null;
      var vw = window.innerWidth || 0;
      var vh = window.innerHeight || 0;
      var left = Math.max(0, r.left);
      var right = vw > 0 ? Math.min(vw, r.right) : r.right;
      var top = Math.max(0, r.top);
      var bottom = vh > 0 ? Math.min(vh, r.bottom) : r.bottom;
      if (right - left < 40 || bottom - top < 40) return null;
      var stack = document.elementsFromPoint((left + right) / 2, (top + bottom) / 2);
      var below = false;
      for (var i = 0; i < stack.length && i < 24; i++) {
        var node = stack[i];
        if (node === el) { below = true; continue; }
        if (!below || el.contains(node) || node.contains(el)) continue;
        for (var depth = 0; depth < 12 && node && node !== document.body && node !== document.documentElement; depth++) {
          if (node.contains(el)) break;
          var ids = contentIdsWithin(node);
          if (ids.count === 1) return ids.id;
          if (ids.count > 1) break;
          node = node.parentElement;
        }
        return null;
      }
    } catch (e) {}
    return null;
  }

  function readExplicitAdMarker(el) {
    try {
      var node = el;
      for (var depth = 0; depth < 6 && node; depth++) {
        if (isSharedMediaContainer(node, el)) break;
        var label = '';
        if (node.getAttribute) {
          label = (node.getAttribute('aria-label') || '') + ' ' + (node.getAttribute('data-ad') || '');
        }
        var textHint = '';
        try {
          if (node.innerText && node.innerText.length < 80) textHint = node.innerText;
        } catch (e2) {}
        var blob = (label + ' ' + textHint).toLowerCase();
        if (blob.indexOf('sponsored') >= 0 || blob.indexOf('advert') >= 0 ||
            /\\bads?\\b/.test(blob) || blob.indexOf('promotion') >= 0) {
          return true;
        }
        node = node.parentElement;
      }
    } catch (e) {}
    return false;
  }

  function isElementDisplayed(el) {
    try {
      var style = window.getComputedStyle ? getComputedStyle(el) : null;
      if (!style) return true;
      if (style.display === 'none' || style.visibility === 'hidden' || style.opacity === '0') {
        return false;
      }
      var r = el.getBoundingClientRect();
      return r.width >= 2 && r.height >= 2;
    } catch (e) { return true; }
  }

  function isVisibleStyle(el) {
    try {
      var style = window.getComputedStyle ? getComputedStyle(el) : null;
      if (!style) return true;
      return style.visibility !== 'hidden' && style.display !== 'none';
    } catch (e) { return true; }
  }

  function viewportCenterDistance(el) {
    try {
      var r = el.getBoundingClientRect();
      var cx = r.left + r.width / 2;
      var cy = r.top + r.height / 2;
      var vx = (window.innerWidth || 0) / 2;
      var vy = (window.innerHeight || 0) / 2;
      var dx = cx - vx;
      var dy = cy - vy;
      return Math.sqrt(dx * dx + dy * dy);
    } catch (e) { return null; }
  }

  function collectActiveVideoPayload(el) {
    pageUrl = location.href;
    var rawSrc = '';
    rawSrc = currentSourceOf(el);
    var isBlob = typeof rawSrc === 'string' && rawSrc.toLowerCase().indexOf('blob:') === 0;
    var ratio = null;
    try {
      if (intersectionByEl && intersectionByEl.has(el)) ratio = intersectionByEl.get(el);
    } catch (e2) {}
    var recentlyPlayed = false;
    try {
      if (recentPlayUntil && recentPlayUntil.has(el)) {
        recentlyPlayed = recentPlayUntil.get(el) > Date.now();
      }
    } catch (e3) {}
    // The size it is drawn at: a full-resolution video scaled into a thumbnail is still a preview.
    var displayBox = null;
    try { displayBox = el.getBoundingClientRect(); } catch (eBox) {}
    var currentTimeBucket = null;
    try {
      if (typeof el.currentTime === 'number' && isFinite(el.currentTime)) {
        currentTimeBucket = Math.floor(el.currentTime / 5);
      }
    } catch (e4) {}
    return {
      pageUrl: pageUrl,
      elementIdentity: ensureVideoIdentity(el),
      currentSrc: rawSrc ? String(rawSrc).slice(0, isBlob ? 512 : 2048) : null,
      src: (function() {
        try {
          var s = el.src || el.getAttribute('src');
          return s ? String(s).slice(0, 2048) : null;
        } catch (e5) { return null; }
      })(),
      isBlob: isBlob,
      paused: typeof el.paused === 'boolean' ? el.paused : null,
      ended: typeof el.ended === 'boolean' ? el.ended : null,
      readyState: typeof el.readyState === 'number' ? el.readyState : null,
      videoWidth: typeof el.videoWidth === 'number' ? el.videoWidth : null,
      videoHeight: typeof el.videoHeight === 'number' ? el.videoHeight : null,
      muted: typeof el.muted === 'boolean' ? el.muted : null,
      currentTimeBucket: currentTimeBucket,
      intersectionRatio: ratio,
      viewportCenterDistance: viewportCenterDistance(el),
      displayWidth: displayBox ? Math.round(displayBox.width) : null,
      displayHeight: displayBox ? Math.round(displayBox.height) : null,
      isDisplayed: isElementDisplayed(el),
      isVisibleStyle: isVisibleStyle(el),
      recentlyPlayed: recentlyPlayed || (typeof el.paused === 'boolean' && !el.paused),
      explicitAdMarker: readExplicitAdMarker(el),
      associatedContentId: readAssociatedContentId(el),
      isProtected: isProtectedElement(el),
      sourceKind: isBlob ? (mseObjectUrls[String(rawSrc).slice(0, 512)] || (mediaSourceFor(el, rawSrc) ? 'mse' : 'blob')) : null,
      mseTracks: isBlob ? mseTrackLayoutOf(el, rawSrc) : null,
      mseFiles: isBlob ? mseFilesOf(el, rawSrc) : null,
      duration: typeof el.duration === 'number' && isFinite(el.duration) && el.duration > 0 ? el.duration : null
    };
  }

  function pickBestActiveVideo() {
    var videos = collectVideoElements();
    var best = null;
    var bestScore = -1;
    var count = Math.min(videos.length, MAX_TRACKED_VIDEOS);
    for (var i = 0; i < count; i++) {
      var el = videos[i];
      ensureVideoIdentity(el);
      try { if (io) io.observe(el); } catch (e) {}
      var score = 0;
      var ratio = 0;
      try {
        if (intersectionByEl && intersectionByEl.has(el)) ratio = intersectionByEl.get(el) || 0;
      } catch (e2) {}
      score += ratio * 100;
      var dist = viewportCenterDistance(el);
      if (dist != null) score += Math.max(0, 40 - dist / 20);
      try {
        if (typeof el.paused === 'boolean' && !el.paused) score += 50;
      } catch (e3) {}
      try {
        if (recentPlayUntil && recentPlayUntil.has(el) && recentPlayUntil.get(el) > Date.now()) {
          score += 25;
        }
      } catch (e4) {}
      // Phase 5A — tiny muted loops / card previews must not outrank a main player.
      try {
        var vw = typeof el.videoWidth === 'number' ? el.videoWidth : 0;
        var vh = typeof el.videoHeight === 'number' ? el.videoHeight : 0;
        var muted = typeof el.muted === 'boolean' && el.muted;
        if ((vw > 0 && vw < 240) || (vh > 0 && vh < 240) || (vw > 0 && vh > 0 && vw * vh < 57600)) {
          score -= muted ? 55 : 25;
        }
        try {
          var rbox = el.getBoundingClientRect();
          if (rbox && rbox.width > 0 && rbox.height > 0 && rbox.width * rbox.height < 40000) {
            score -= muted ? 40 : 15;
          }
        } catch (e5) {}
      } catch (e6) {}
      if (!isElementDisplayed(el)) score -= 80;
      if (score > bestScore) {
        bestScore = score;
        best = el;
      }
    }
    return best;
  }

  function pickBestPlayerIframe() {
    var iframes = document.querySelectorAll('iframe');
    var best = null;
    var bestScore = -1;
    var count = Math.min(iframes.length, MAX_TRACKED_IFRAMES);
    for (var i = 0; i < count; i++) {
      var el = iframes[i];
      ensureIframeIdentity(el);
      try { if (io) io.observe(el); } catch (e) {}
      var displayed = isElementDisplayed(el);
      var looks = looksLikePlayerIframe(el);
      if (!displayed && !looks) continue;
      var score = 0;
      var ratio = 0;
      try {
        if (intersectionByEl && intersectionByEl.has(el)) ratio = intersectionByEl.get(el) || 0;
      } catch (e2) {}
      score += ratio * 100;
      var dist = viewportCenterDistance(el);
      if (dist != null) score += Math.max(0, 40 - dist / 20);
      try {
        var box = el.getBoundingClientRect();
        if (box && box.width > 0 && box.height > 0) {
          score += Math.min(80, (box.width * box.height) / 8000);
        }
      } catch (e3) {}
      if (looks) score += 60;
      if (!displayed) score -= 80;
      if (score > bestScore && (looks || (displayed && ratio >= 0.25))) {
        bestScore = score;
        best = el;
      }
    }
    if (best && !looksLikePlayerIframe(best)) return null;
    return best;
  }

  function collectIframePlayerPayload(el) {
    pageUrl = location.href;
    var rawSrc = '';
    try { rawSrc = el.src || el.getAttribute('src') || ''; } catch (e) {}
    var ratio = null;
    try {
      if (intersectionByEl && intersectionByEl.has(el)) ratio = intersectionByEl.get(el);
    } catch (e2) {}
    var boxW = null;
    var boxH = null;
    try {
      var r = el.getBoundingClientRect();
      if (r) { boxW = r.width; boxH = r.height; }
    } catch (e3) {}
    var allow = null;
    try { allow = el.getAttribute('allow'); } catch (e4) {}
    var allowFs = false;
    try {
      allowFs = !!(el.allowFullscreen || el.hasAttribute('allowfullscreen') ||
        el.getAttribute('allowfullscreen') != null);
    } catch (e5) {}
    var innerCount = sameOriginVideoCount(el);
    return {
      pageUrl: pageUrl,
      iframeIdentity: ensureIframeIdentity(el),
      iframeSrc: sanitizeIframeSrc(rawSrc),
      frameClass: iframeFrameClass(el),
      isDisplayed: isElementDisplayed(el),
      isVisibleStyle: isVisibleStyle(el),
      intersectionRatio: ratio,
      viewportCenterDistance: viewportCenterDistance(el),
      width: boxW,
      height: boxH,
      allowFullscreen: allowFs,
      allow: allow,
      looksPlayer: looksLikePlayerIframe(el),
      sameOriginVideoCount: innerCount,
      associatedContentId: (function() {
        try {
          var locHm = String(location.href).match(/\\/(?:video|watch|embed|media)\\/([A-Za-z0-9_-]{5,32})/i);
          if (locHm && locHm[1]) return String(locHm[1]).slice(0, 32);
          var q = rawSrc ? String(rawSrc).match(/[?&#](?:video|v)=([A-Za-z0-9_-]{5,32})(?:[&#]|$)/i) : null;
          if (q && q[1]) return String(q[1]).slice(0, 32);
          // A player document that is told what to play (its src names nothing): the item it sits in or over.
          return readAssociatedContentId(el, true) || readOverlaidContentId(el);
        } catch (e6) {}
        return null;
      })()
    };
  }

  function isLikelyPreviewVideo(el) {
    try {
      var vw = typeof el.videoWidth === 'number' ? el.videoWidth : 0;
      var vh = typeof el.videoHeight === 'number' ? el.videoHeight : 0;
      if ((vw > 0 && vw < 240) || (vh > 0 && vh < 240) || (vw > 0 && vh > 0 && vw * vh < 57600)) {
        return true;
      }
      var rbox = el.getBoundingClientRect();
      if (rbox && rbox.width > 0 && rbox.height > 0 && rbox.width * rbox.height < 40000) {
        return true;
      }
    } catch (e) {}
    return false;
  }

  function flushActiveVideo() {
    activeVideoTimer = null;
    try {
      var el = pickBestActiveVideo();
      var videoDisplayed = false;
      try { videoDisplayed = !!(el && isElementDisplayed(el)); } catch (eDisp) {}
      var videoIsPreview = !!(el && isLikelyPreviewVideo(el));
      if (el && videoDisplayed && !videoIsPreview) {
        var payload = collectActiveVideoPayload(el);
        var key = payload.elementIdentity + '|' + (payload.currentSrc || '') + '|' +
          String(payload.paused) + '|' + String(payload.intersectionRatio) + '|' +
          String(payload.recentlyPlayed) + '|' + String(payload.associatedContentId) + '|' +
          String(payload.isProtected) + '|' + String(payload.sourceKind) + '|' + String(payload.mseTracks) + '|' +
          (payload.mseFiles ? String(payload.mseFiles.video) + '+' + String(payload.mseFiles.audio) : '') + '|' +
          String(payload.duration);
        if (key === lastActiveVideoKey) return;
        lastActiveVideoKey = key;
        post('active_video', payload);
        return;
      }
      var iframe = pickBestPlayerIframe();
      if (iframe) {
        var iframePayload = collectIframePlayerPayload(iframe);
        if (iframePayload.looksPlayer && iframePayload.isDisplayed) {
          var iframeKey = 'iframe|' + iframePayload.iframeIdentity + '|' +
            (iframePayload.iframeSrc || '') + '|' + String(iframePayload.intersectionRatio) + '|' +
            String(iframePayload.associatedContentId);
          if (iframeKey === lastActiveVideoKey) return;
          lastActiveVideoKey = iframeKey;
          post('active_iframe_player', iframePayload);
          return;
        }
      }
      if (el && videoDisplayed) {
        var previewPayload = collectActiveVideoPayload(el);
        var previewKey = previewPayload.elementIdentity + '|' + (previewPayload.currentSrc || '') + '|' +
          String(previewPayload.paused) + '|' + String(previewPayload.intersectionRatio) + '|' +
          String(previewPayload.recentlyPlayed) + '|' + String(previewPayload.associatedContentId) + '|' +
          String(previewPayload.isProtected) + '|' + String(previewPayload.sourceKind) + '|' +
          String(previewPayload.mseTracks) + '|' +
          (previewPayload.mseFiles ? String(previewPayload.mseFiles.video) + '+' + String(previewPayload.mseFiles.audio) : '');
        if (previewKey === lastActiveVideoKey) return;
        lastActiveVideoKey = previewKey;
        post('active_video', previewPayload);
      }
    } catch (e) {}
  }

  function scheduleActiveVideo() {
    if (disposed || suspended || activeVideoTimer) return;
    activeVideoTimer = setTimeout(flushActiveVideo, Math.max(${batchMs}, ${throttleMs}));
  }

  /**
   * Every observer and listener this script owns, created in one place so teardown can be undone.
   * Idempotent: a second call while already attached is a no-op, so a re-injection or a restore can
   * never leave two observer sets on one document.
   */
  function attachObservers() {
    if (attached) return;
    attached = true;
    disposed = false;
    try {
      mo = new MutationObserver(function() {
        scheduleScanDom();
        scheduleActiveVideo();
      });
      mo.observe(document.documentElement || document.body, {
        childList: true,
        subtree: true,
        attributes: true,
        attributeFilter: ['src', 'type', 'poster']
      });
    } catch (e) {}

    try {
      if (window.PerformanceObserver) {
        po = new PerformanceObserver(function(list) {
          var entries = list.getEntries();
          for (var i = 0; i < entries.length; i++) {
            observePerfEntry(entries[i]);
          }
        });
        po.observe({ entryTypes: ['resource'] });
      }
    } catch (e) {}

    try {
      if (window.IntersectionObserver) {
        io = new IntersectionObserver(function(entries) {
          for (var i = 0; i < entries.length; i++) {
            try {
              if (intersectionByEl) {
                intersectionByEl.set(entries[i].target, entries[i].intersectionRatio);
              }
            } catch (e) {}
          }
          scheduleActiveVideo();
        }, { threshold: [0, 0.25, 0.5, 0.75, 1] });
      }
    } catch (e) {}

    attachMediaListeners(document);
    try { window.addEventListener('popstate', onPopState); } catch (e) {}
    // A feed can move its one player over the next item without any DOM or visibility change the observers above
    // see; the report after scrolling settles names the item it is over now. Capture: inner scrollers count too.
    try { window.addEventListener('scroll', onScrollSettle, { passive: true, capture: true }); } catch (e) {}
  }

  function onScrollSettle() {
    scheduleActiveVideo();
  }

  function detachObservers() {
    attached = false;
    try {
      if (batchTimer) { clearTimeout(batchTimer); batchTimer = null; }
      if (scanTimer) { clearTimeout(scanTimer); scanTimer = null; }
      if (activeVideoTimer) { clearTimeout(activeVideoTimer); activeVideoTimer = null; }
      if (titleTimer) { clearTimeout(titleTimer); titleTimer = null; }
      if (mo) { mo.disconnect(); mo = null; }
      if (po) { po.disconnect(); po = null; }
      if (io) { io.disconnect(); io = null; }
      detachMediaListeners();
      window.removeEventListener('popstate', onPopState);
      window.removeEventListener('scroll', onScrollSettle, true);
    } catch (e) {}
  }

  function markRecentPlay(ev) {
    try {
      var t = ev && ev.target;
      if (!t) return;
      var tag = (t.tagName || '').toLowerCase();
      if (tag !== 'video' && tag !== 'audio') return;
      if (recentPlayUntil) recentPlayUntil.set(t, Date.now() + 12000);
      mediaFromElement(t, tag === 'video' ? 'dom_video' : 'dom_audio');
      if (tag === 'video') scheduleActiveVideo();
    } catch (e) {}
  }
  function onPause(ev) {
    try {
      var t = ev && ev.target;
      if (!t || (t.tagName || '').toLowerCase() !== 'video') return;
      scheduleActiveVideo();
    } catch (e) {}
  }
  function onEncrypted(ev) {
    if (ev.target) ev.target.__vidoraxEncrypted = true;
    seen = Object.create(null);
    seenKeys = [];
    lastActiveVideoKey = '';
    // A blob/MSE player produces no DOM candidate, so the encrypted evidence has to travel on its own.
    try {
      var t = ev && ev.target;
      var encSrc = t && (t.currentSrc || t.src);
      if (isBlobUrl(encSrc)) postBlobIndicator(encSrc, t, null);
    } catch (e) {}
    scheduleScanDom();
    scheduleActiveVideo();
  }

  // An SPA names its new route after pushState returns (after rendering, often after a fetch): the title read at the
  // route change is still the previous route's. Look again for a few seconds and report the name once it changes.
  var titleTimer = null;
  function watchRouteTitle() {
    var previousTitle = document.title;
    var checks = 0;
    if (titleTimer) { clearTimeout(titleTimer); titleTimer = null; }
    function check() {
      titleTimer = null;
      if (disposed) return;
      if (document.title !== previousTitle) {
        readMeta();
        return;
      }
      checks += 1;
      if (checks < ${ROUTE_TITLE_CHECKS}) titleTimer = setTimeout(check, ${ROUTE_TITLE_CHECK_MS});
    }
    titleTimer = setTimeout(check, ${ROUTE_TITLE_CHECK_MS});
  }

  function onPopState() {
    // Pending candidates belong to the previous document content.
    pending = [];
    pageUrl = location.href;
    seen = Object.create(null);
    seenKeys = [];
    postCount = 0;
    lastActiveVideoKey = '';
    readMeta();
    watchRouteTitle();
    harvestEmbeddedMedia();
    scheduleScanDom();
    scheduleActiveVideo();
  }

  // The app asks for this when the page's earlier reports could not be used — the Browser was hidden, or another
  // tab was in front while this page posted: report everything the page shows now, exactly as after a route change.
  window.__VIDORAX_MEDIA_RESCAN__ = function() {
    if (disposed || suspended) return false;
    onPopState();
    return true;
  };

  // A hidden document costs nothing: observers are detached and nothing is queued. Becoming visible again reports the
  // page afresh, exactly like a route change, so the video in front is announced even if it changed meanwhile.
  function setSuspended(next) {
    if (disposed || next === suspended) return;
    suspended = next;
    if (next) {
      pending = [];
      detachObservers();
      try { suspendedAt = performance.now(); } catch (e) { suspendedAt = 0; }
      return;
    }
    attachObservers();
    onPopState();
    // Only what was requested while hidden: older entries can belong to a video the page has since replaced.
    replayPerformanceEntries(suspendedAt);
  }
  var suspendedAt = 0;
  try {
    document.addEventListener('visibilitychange', function() {
      setSuspended(document.visibilityState === 'hidden');
    });
  } catch (e) {}

  // History patching is per-document and must not be re-applied on a restore, or each navigation
  // would run onPopState once per stacked wrapper.
  try {
    var _push = history.pushState;
    var _replace = history.replaceState;
    history.pushState = function() {
      var r = _push.apply(this, arguments);
      onPopState();
      return r;
    };
    history.replaceState = function() {
      var r = _replace.apply(this, arguments);
      onPopState();
      return r;
    };
  } catch (e) {}

  /**
   * Teardown is reversible. Leaving the re-entry guard set while everything is disconnected made a
   * back/forward restore permanently blind: the WebView re-injects this script, the guard returns
   * immediately, and the restored document has no observers at all.
   */
  function cleanup() {
    disposed = true;
    pending = [];
    seen = Object.create(null);
    seenKeys = [];
    detachObservers();
    try { window.__VIDORAX_MEDIA_DETECTION__ = false; } catch (e) {}
  }
  window.addEventListener('pagehide', cleanup);

  // Restored from the back/forward cache without a fresh injection — rebuild and rescan.
  window.addEventListener('pageshow', function(ev) {
    try {
      if (!ev || !ev.persisted) return;
      window.__VIDORAX_MEDIA_DETECTION__ = true;
      disposed = false;
      if (document.visibilityState === 'hidden') {
        suspended = true;
        return;
      }
      suspended = false;
      attachObservers();
      onPopState();
    } catch (e) {}
  });

  try {
    var early = window.__VIDORAX_MEDIA_EARLY_RESOURCES__;
    if (early && early.length) {
      for (var ei = 0; ei < early.length; ei++) {
        var earlyAbs = safeUrl(String(early[ei]));
        if (earlyAbs && looksMedia(earlyAbs, null)) {
          enqueue({
            url: earlyAbs,
            pageUrl: pageUrl,
            mimeType: null,
            extension: extOf(earlyAbs),
            title: document.title || null,
            thumbnailUrl: null,
            duration: null,
            width: null,
            height: null,
            estimatedFileSize: null,
            isLive: false,
            isDrm: false,
            playlistType: null,
            detectionSource: 'performance_resource',
            tagName: null
          });
        }
      }
      window.__VIDORAX_MEDIA_EARLY_RESOURCES__ = [];
    }
  } catch (e) {}

  try {
    if (window.__VIDORAX_MEDIA_EARLY_PO__) {
      window.__VIDORAX_MEDIA_EARLY_PO__.disconnect();
      window.__VIDORAX_MEDIA_EARLY_PO__ = null;
    }
  } catch (e) {}

  if (document.visibilityState === 'hidden') {
    // Injected into a parked tab (a reload or redirect while it was in the background): wait until it is shown.
    suspended = true;
  } else {
    attachObservers();
    readMeta();
    scanDom();
    harvestEmbeddedMedia();
    flushActiveVideo();
    scheduleActiveVideo();
  }

  // The newest resource entries (from sinceMs on): requests made before the observer existed, or while hidden.
  function replayPerformanceEntries(sinceMs) {
    try {
      if (!window.performance || !performance.getEntriesByType) return;
      var entries = performance.getEntriesByType('resource');
      var start = Math.max(0, entries.length - 80);
      for (var i = start; i < entries.length; i++) {
        if (sinceMs && entries[i].startTime < sinceMs) continue;
        observePerfEntry(entries[i]);
      }
    } catch (err) {}
  }
  if (!suspended) replayPerformanceEntries(0);

  // Narrow native-app promotion suppression — CSS only, no polling, no timer.
  // Hides elements whose href points to known native-app awakening schemes.
  // Does NOT hide video controls, comments, captions, share, or follow elements.
  try {
    var suppressStyle = document.createElement('style');
    suppressStyle.textContent =
      'a[href^="snssdk"],a[href^="musically:"],' +
      'a[href^="tiktok:"],a[href^="aweme:"],a[href^="sslocal:"],' +
      'a[href^="bytedance:"],a[href^="android-app:"],' +
      'a[href^="instagram:"],a[href^="fb:"],' +
      'a[href^="fbapi:"],a[href^="fb-messenger:"],a[href^="snapchat:"],' +
      'a[href^="twitter:"],a[href^="vnd.youtube:"],a[href^="youtube:"],' +
      'a[href^="market:"],a[href^="intent:"]' +
      '{display:none!important;pointer-events:none!important;height:0!important;overflow:hidden!important}';
    (document.head || document.documentElement).appendChild(suppressStyle);
  } catch (e) {}

  post('ready', {});
  post('scan_complete', {});
  return true;
})();true;`;
}

/** Lightweight early resource capture — drained by the main observer after load. */
/**
 * Asks the detector already running in a page to report everything it shows again (see `__VIDORAX_MEDIA_RESCAN__`).
 * Harmless on a page without the detector.
 */
export function buildMediaDetectionRescanScript(): string {
  return '(function(){try{if(typeof window.__VIDORAX_MEDIA_RESCAN__==="function"){window.__VIDORAX_MEDIA_RESCAN__();}}catch(e){}})();true;';
}

export function buildMediaDetectionBeforeContentScript(): string {
  return `(function(){
${MSE_OBSERVATION_SOURCE}
  try {
    if (window.__VIDORAX_MEDIA_EARLY__) return true;
    window.__VIDORAX_MEDIA_EARLY__ = true;
    // Before any page script: a player built while the page loads is observed from its first SourceBuffer.
    vidoraxMseObservation();
    window.__VIDORAX_MEDIA_EARLY_RESOURCES__ = [];
    if (window.PerformanceObserver) {
      var po = new PerformanceObserver(function(list) {
        var entries = list.getEntries();
        for (var i = 0; i < entries.length; i++) {
          window.__VIDORAX_MEDIA_EARLY_RESOURCES__.push(String(entries[i].name));
          if (window.__VIDORAX_MEDIA_EARLY_RESOURCES__.length > 200) {
            window.__VIDORAX_MEDIA_EARLY_RESOURCES__.shift();
          }
        }
      });
      po.observe({ entryTypes: ['resource'] });
      window.__VIDORAX_MEDIA_EARLY_PO__ = po;
      window.addEventListener('pagehide', function() {
        try {
          po.disconnect();
          window.__VIDORAX_MEDIA_EARLY_PO__ = null;
        } catch (e) {}
      }, { once: true });
    }
  } catch (e) {}
  return true;
})();true;`;
}
