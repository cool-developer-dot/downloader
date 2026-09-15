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
  'mp4|webm|mov|m4v|mkv|avi|mpeg|mpg|m2ts|3gp|3g2|flv|wmv|ogv';
const AUDIO_EXTS = 'mp3|m4a|aac|ogg|opus|wav|flac';
const STREAM_EXTS = 'm3u8|mpd';
/** .ts excluded from extension-alone matching — segment noise. */

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
  var seen = Object.create(null);
  var seenKeys = [];
  var MAX_SEEN = 320;
  var disposed = false;
  var batchTimer = null;
  var lastFlushAt = 0;
  var pageUrl = location.href;
  var postCount = 0;
  var MAX_POSTS = 400;
  var POST_WINDOW_MS = 1000;
  var MAX_POSTS_PER_WINDOW = 28;
  var postWindowStart = 0;
  var postsInWindow = 0;

  function post(type, payload) {
    try {
      if (disposed) return;
      var now = Date.now();
      if (now - postWindowStart >= POST_WINDOW_MS) {
        postWindowStart = now;
        postsInWindow = 0;
        postCount = 0;
      }
      var priority = type === 'active_video' || type === 'active_iframe_player' ||
        type === 'blob_indicator' || type === 'page_meta' || type === 'ready' ||
        type === 'scan_complete';
      if (postsInWindow >= MAX_POSTS_PER_WINDOW && !priority) return;
      if (postCount >= MAX_POSTS) return;
      if (!window.ReactNativeWebView || !window.ReactNativeWebView.postMessage) {
        return;
      }
      postsInWindow += 1;
      postCount += 1;
      window.ReactNativeWebView.postMessage(JSON.stringify({
        channel: CHANNEL,
        type: type,
        payload: payload,
        ts: Date.now()
      }));
    } catch (e) {}
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
    if (disposed || !candidate || !candidate.url) return;
    candidate.url = canonicalizePlaybackUrl(candidate.url);
    if (isBlobUrl(candidate.url)) {
      post('blob_indicator', { pageUrl: pageUrl, blobUrl: String(candidate.url).slice(0, 512) });
      return;
    }
    var key = candidate.url + '|' + (candidate.mimeType || '') + '|' +
      (candidate.ownerElementIdentity || '') + '|' + String(candidate.width) + '|' + String(candidate.height);
    if (seen[key]) return;
    seen[key] = 1;
    seenKeys.push(key);
    if (seenKeys.length > MAX_SEEN) delete seen[seenKeys.shift()];
    pending.push(candidate);
    if (pending.length > ${maxBatch}) {
      flush();
      return;
    }
    if (batchTimer) return;
    var delay = ${batchMs};
    var since = Date.now() - lastFlushAt;
    if (since < ${throttleMs}) delay = Math.max(delay, ${throttleMs} - since);
    batchTimer = setTimeout(flush, delay);
  }

  function flush() {
    if (batchTimer) { clearTimeout(batchTimer); batchTimer = null; }
    if (!pending.length) return;
    var batch = pending.slice(0, ${maxBatch});
    pending = [];
    lastFlushAt = Date.now();
    post('mutation_batch', { candidates: batch, pageUrl: pageUrl });
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
      post('blob_indicator', { pageUrl: pageUrl, blobUrl: String(ogVideo).slice(0, 512) });
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

  function mediaFromElement(el, source) {
    if (!el) return;
    var tag = (el.tagName || '').toLowerCase();
    var rawSrc = el.currentSrc || el.src || el.getAttribute('src');
    if (isBlobUrl(rawSrc)) {
      post('blob_indicator', { pageUrl: pageUrl, blobUrl: String(rawSrc).slice(0, 512) });
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

  function scanDom() {
    pageUrl = location.href;
    var videos = document.querySelectorAll('video');
    for (var i = 0; i < videos.length; i++) {
      mediaFromElement(videos[i], 'dom_video');
      var sources = videos[i].querySelectorAll('source');
      for (var s = 0; s < sources.length; s++) {
        mediaFromElement(sources[s], 'dom_source');
      }
    }
    var audios = document.querySelectorAll('audio');
    for (var a = 0; a < audios.length; a++) {
      mediaFromElement(audios[a], 'dom_audio');
      var aSources = audios[a].querySelectorAll('source');
      for (var as = 0; as < aSources.length; as++) {
        mediaFromElement(aSources[as], 'dom_source');
      }
    }
  }

  function observePerfEntry(e) {
    try {
      var name = e && e.name ? String(e.name) : '';
      if (isBlobUrl(name)) {
        post('blob_indicator', { pageUrl: pageUrl, blobUrl: name.slice(0, 512) });
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
        post('blob_indicator', { pageUrl: pageUrl, blobUrl: String(rawUrl).slice(0, 512) });
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

  // MediaSource URL observation — blob created from MSE is indicator only.
  try {
    if (window.URL && URL.createObjectURL) {
      var _create = URL.createObjectURL;
      URL.createObjectURL = function(obj) {
        var blobUrl = _create.apply(this, arguments);
        try {
          if (obj && (obj.type || '').indexOf('video') === 0) {
            post('blob_indicator', { pageUrl: pageUrl, blobUrl: String(blobUrl).slice(0, 512) });
          }
        } catch (e) {}
        return blobUrl;
      };
    }
  } catch (e) {}

  var scanTimer = null;
  function scheduleScanDom() {
    if (disposed || scanTimer) return;
    scanTimer = setTimeout(function() {
      scanTimer = null;
      scanDom();
    }, ${batchMs});
  }

  var mo = null;
  var po = null;

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

  function onLoadedMetadata(ev) {
    var t = ev.target;
    if (!t) return;
    var tag = (t.tagName || '').toLowerCase();
    if (tag === 'video') mediaFromElement(t, 'dom_video');
    if (tag === 'audio') mediaFromElement(t, 'dom_audio');
  }
  document.addEventListener('loadedmetadata', onLoadedMetadata, true);

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

  function readAssociatedContentId(el) {
    try {
      var node = el;
      for (var depth = 0; depth < 16 && node; depth++) {
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
      try {
        var locHm = String(location.href).match(/\\/(?:video|watch|embed|media)\\/([A-Za-z0-9_-]{5,32})/i);
        if (locHm && locHm[1]) return String(locHm[1]).slice(0, 32);
      } catch (eLoc) {}
    } catch (e) {}
    return null;
  }

  function readExplicitAdMarker(el) {
    try {
      var node = el;
      for (var depth = 0; depth < 6 && node; depth++) {
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
    try { rawSrc = el.currentSrc || el.src || el.getAttribute('src') || ''; } catch (e) {}
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
      isDisplayed: isElementDisplayed(el),
      isVisibleStyle: isVisibleStyle(el),
      recentlyPlayed: recentlyPlayed || (typeof el.paused === 'boolean' && !el.paused),
      explicitAdMarker: readExplicitAdMarker(el),
      associatedContentId: readAssociatedContentId(el)
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
          String(payload.recentlyPlayed) + '|' + String(payload.associatedContentId);
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
          String(previewPayload.recentlyPlayed) + '|' + String(previewPayload.associatedContentId);
        if (previewKey === lastActiveVideoKey) return;
        lastActiveVideoKey = previewKey;
        post('active_video', previewPayload);
      }
    } catch (e) {}
  }

  function scheduleActiveVideo() {
    if (disposed || activeVideoTimer) return;
    activeVideoTimer = setTimeout(flushActiveVideo, Math.max(${batchMs}, ${throttleMs}));
  }

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

  function markRecentPlay(ev) {
    try {
      var t = ev && ev.target;
      if (!t || (t.tagName || '').toLowerCase() !== 'video') return;
      if (recentPlayUntil) recentPlayUntil.set(t, Date.now() + 12000);
      scheduleActiveVideo();
      mediaFromElement(t, 'dom_video');
    } catch (e) {}
  }
  document.addEventListener('play', markRecentPlay, true);
  document.addEventListener('playing', markRecentPlay, true);
  document.addEventListener('loadeddata', markRecentPlay, true);
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
    scheduleScanDom();
    scheduleActiveVideo();
  }
  document.addEventListener('pause', onPause, true);
  document.addEventListener('encrypted', onEncrypted, true);

  function onPopState() {
    // Pending candidates belong to the previous document content.
    pending = [];
    pageUrl = location.href;
    seen = Object.create(null);
    seenKeys = [];
    postCount = 0;
    lastActiveVideoKey = '';
    readMeta();
    harvestEmbeddedMedia();
    scheduleScanDom();
    scheduleActiveVideo();
  }

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
    window.addEventListener('popstate', onPopState);
  } catch (e) {}

  function cleanup() {
    disposed = true;
    pending = [];
    seen = Object.create(null);
    seenKeys = [];
    try {
      if (batchTimer) { clearTimeout(batchTimer); batchTimer = null; }
      if (scanTimer) { clearTimeout(scanTimer); scanTimer = null; }
      if (activeVideoTimer) { clearTimeout(activeVideoTimer); activeVideoTimer = null; }
      if (mo) { mo.disconnect(); mo = null; }
      if (po) { po.disconnect(); po = null; }
      if (io) { io.disconnect(); io = null; }
      document.removeEventListener('loadedmetadata', onLoadedMetadata, true);
      document.removeEventListener('play', markRecentPlay, true);
      document.removeEventListener('playing', markRecentPlay, true);
      document.removeEventListener('loadeddata', markRecentPlay, true);
      document.removeEventListener('pause', onPause, true);
      document.removeEventListener('encrypted', onEncrypted, true);
      window.removeEventListener('popstate', onPopState);
      window.removeEventListener('pagehide', cleanup);
    } catch (e) {}
  }
  window.addEventListener('pagehide', cleanup);

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

  readMeta();
  scanDom();
  harvestEmbeddedMedia();
  flushActiveVideo();
  scheduleActiveVideo();

  try {
    if (window.performance && performance.getEntriesByType) {
      try {
        var entries = performance.getEntriesByType('resource');
        var start = Math.max(0, entries.length - 80);
        for (var i = start; i < entries.length; i++) {
          observePerfEntry(entries[i]);
        }
      } catch (err) {}
    }
  } catch (e) {}

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
export function buildMediaDetectionBeforeContentScript(): string {
  return `(function(){
  try {
    if (window.__VIDORAX_MEDIA_EARLY__) return true;
    window.__VIDORAX_MEDIA_EARLY__ = true;
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
