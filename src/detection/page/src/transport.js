/* global vdx */
// Delivers DetectorMessages (src/detection/types.ts) through window.ReactNativeWebView.postMessage.
// Messages wait in a bounded outbox until the bridge exists; candidates are deduplicated and batched.
const { hashString, utf8Length, setTimer, clearTimer } = vdx.util;

const MAX_BATCH_CANDIDATES = 20;
const MAX_MESSAGE_BYTES = 200000;
// Room for the envelope around a candidates batch: channel, type and frame (URL up to 4 KB, User-Agent).
const ENVELOPE_BYTES = 6000;
const BATCH_DELAY_MS = 250;
const MAX_OUTBOX_MESSAGES = 100;
const MAX_OUTBOX_BYTES = 2000000;
const BRIDGE_RETRY_MS = 250;
const MAX_BRIDGE_RETRIES = 120;
const MAX_REMEMBERED_CANDIDATES = 1000;

const userAgent = String(window.navigator && window.navigator.userAgent ? window.navigator.userAgent : '').slice(0, 512);
const isMainFrame = (() => {
  try {
    return window.top === window;
  } catch (_error) {
    return false;
  }
})();

const outbox = [];
let outboxBytes = 0;
let retryTimer = null;
let retries = 0;

let batch = [];
let batchBytes = 0;
let batchTimer = null;

// candidate key + provenance -> hash of the last version posted, so rescans only send what changed.
let posted = Object.create(null);
let postedCount = 0;

function frameInfo() {
  return { url: String(window.location.href).slice(0, 4096), isMain: isMainFrame, userAgent };
}

function bridge() {
  const target = window.ReactNativeWebView;
  return target && typeof target.postMessage === 'function' ? target : null;
}

/** `fieldsJson` is a serialized object whose members follow the envelope members. */
function serialize(type, fieldsJson) {
  const head = '{"ch":"vdx","v":1,"type":' + JSON.stringify(type) + ',"frame":' + JSON.stringify(frameInfo());
  return fieldsJson === '{}' ? head + '}' : head + ',' + fieldsJson.slice(1);
}

function enqueue(message) {
  outbox.push(message);
  outboxBytes += message.length;
  while (outbox.length > MAX_OUTBOX_MESSAGES || outboxBytes > MAX_OUTBOX_BYTES) {
    outboxBytes -= outbox.shift().length;
    // A dropped batch may hold candidates that are otherwise never resent; let later scans post them again.
    posted = Object.create(null);
    postedCount = 0;
  }
  retries = 0;
  deliver();
}

function deliver() {
  const target = bridge();
  if (!target) {
    scheduleRetry();
    return;
  }
  while (outbox.length) {
    const message = outbox.shift();
    outboxBytes -= message.length;
    try {
      target.postMessage(message);
    } catch (_error) {
      // A failing bridge must never surface in the page; the message is lost.
    }
  }
}

function scheduleRetry() {
  if (retryTimer !== null || retries >= MAX_BRIDGE_RETRIES) return;
  retryTimer = setTimer(() => {
    retryTimer = null;
    retries += 1;
    deliver();
  }, BRIDGE_RETRY_MS);
}

function post(type, fields) {
  enqueue(serialize(type, JSON.stringify(fields || {})));
}

function flushCandidates() {
  if (batchTimer !== null) {
    clearTimer(batchTimer);
    batchTimer = null;
  }
  if (!batch.length) return;
  const items = batch;
  batch = [];
  batchBytes = 0;
  enqueue(serialize('candidates', '{"candidates":[' + items.join(',') + ']}'));
}

function emitCandidates(candidates) {
  for (let i = 0; i < candidates.length; i++) {
    const json = JSON.stringify(candidates[i]);
    const bytes = utf8Length(json) + 1;
    if (bytes > MAX_MESSAGE_BYTES - ENVELOPE_BYTES) continue;
    const id = candidates[i].key + '|' + candidates[i].provenance;
    const fingerprint = hashString(json);
    if (posted[id] === fingerprint) continue;
    if (posted[id] === undefined) {
      if (postedCount >= MAX_REMEMBERED_CANDIDATES) {
        posted = Object.create(null);
        postedCount = 0;
      }
      postedCount += 1;
    }
    posted[id] = fingerprint;

    if (batch.length && batchBytes + bytes > MAX_MESSAGE_BYTES - ENVELOPE_BYTES) flushCandidates();
    batch.push(json);
    batchBytes += bytes;
    if (batch.length >= MAX_BATCH_CANDIDATES) flushCandidates();
  }
  if (batch.length && batchTimer === null) batchTimer = setTimer(flushCandidates, BATCH_DELAY_MS);
}

vdx.transport = { post, emitCandidates };
