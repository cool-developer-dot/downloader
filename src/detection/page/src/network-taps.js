/* global vdx */
// fetch and XMLHttpRequest taps. The page always receives its original response untouched: fetch bodies are
// read from a clone, XHR bodies from the finished request, and only when bodies.shouldRead accepts them.
const { disguise, noop, httpUrl } = vdx.util;
const { MAX_BODY_SIZE, shouldRead, inspectLater } = vdx.bodies;

const MAX_CONCURRENT_READS = 4;

let activeReads = 0;

function requestUrlOf(input) {
  if (typeof input === 'string') return input;
  if (input && typeof input.url === 'string') return input.url;
  return input && typeof input.href === 'string' ? input.href : '';
}

function absolute(url) {
  return httpUrl(url, window.location.href) || String(url || '');
}

/** Body text, or null once it exceeds MAX_BODY_SIZE (the clone is cancelled so it stops buffering). */
async function readCapped(response) {
  const reader = response.body.getReader();
  const decoder = new window.TextDecoder();
  let text = '';
  let bytes = 0;
  for (;;) {
    const step = await reader.read();
    if (step.done) return text + decoder.decode();
    bytes += step.value.byteLength;
    if (bytes > MAX_BODY_SIZE) {
      reader.cancel().catch(noop);
      return null;
    }
    text += decoder.decode(step.value, { stream: true });
  }
}

function onFetchResponse(response, requestedUrl) {
  if (!response || response.type === 'opaque' || !response.body || activeReads >= MAX_CONCURRENT_READS) return;
  const url = response.url || absolute(requestedUrl);
  if (!shouldRead(url, response.headers.get('content-type'))) return;
  if (Number(response.headers.get('content-length')) > MAX_BODY_SIZE) return;
  const copy = response.clone();
  activeReads += 1;
  readCapped(copy).then(
    (text) => {
      activeReads -= 1;
      if (text !== null) inspectLater(text, url);
    },
    () => {
      activeReads -= 1;
    },
  );
}

function installFetchTap() {
  const original = window.fetch;
  if (typeof original !== 'function') return;
  window.fetch = disguise(function (...args) {
    const result = original.apply(this, args);
    try {
      const requestedUrl = requestUrlOf(args[0]);
      result.then((response) => {
        try {
          onFetchResponse(response, requestedUrl);
        } catch (_error) {
          // The page already has its response; inspection failures stay here.
        }
      }, noop);
    } catch (_error) {
      // A non-standard fetch that returns no promise is left alone.
    }
    return result;
  }, original);
}

function inspectXhr(xhr, requestedUrl) {
  const type = xhr.responseType;
  if (type !== '' && type !== 'text' && type !== 'json') return;
  const url = xhr.responseURL || absolute(requestedUrl);
  if (!shouldRead(url, xhr.getResponseHeader('content-type'))) return;
  if (type === 'json') {
    if (xhr.response !== null && typeof xhr.response === 'object') inspectLater(xhr.response, url);
    return;
  }
  inspectLater(xhr.responseText, url);
}

function installXhrTap() {
  const proto = window.XMLHttpRequest && window.XMLHttpRequest.prototype;
  if (!proto || typeof proto.open !== 'function' || typeof proto.send !== 'function') return;
  const originalOpen = proto.open;
  const originalSend = proto.send;
  const requestedUrls = new WeakMap();

  function onLoad() {
    try {
      inspectXhr(this, requestedUrls.get(this));
    } catch (_error) {
      // Never affects the request.
    }
  }

  proto.open = disguise(function (...args) {
    try {
      requestedUrls.set(this, String(args[1]));
    } catch (_error) {
      // Opening proceeds without a remembered URL; responseURL still identifies the response.
    }
    return originalOpen.apply(this, args);
  }, originalOpen);

  proto.send = disguise(function (...args) {
    try {
      this.addEventListener('load', onLoad);
    } catch (_error) {
      // Sending proceeds unobserved.
    }
    return originalSend.apply(this, args);
  }, originalSend);
}

vdx.taps = { installFetchTap, installXhrTap };
