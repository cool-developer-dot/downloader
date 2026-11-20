// VidoraX Remote control (P6, #439 / #438 / #511) — the Web UI the phone serves on the local network.
// Everything from the phone (titles come from websites) is put in the page with textContent, never as HTML.

import {
  deviceName,
  formatBytes,
  formatEta,
  formatSpeed,
  isLinkPending,
  linkFromInput,
  percent,
  pinFromHash,
  safeHttpUrl,
  stateKey,
} from './format.mjs';
import { translator } from './strings.mjs';

const TOKEN_KEY = 'vidorax-remote-token';
const QUEUE_POLL_MS = 1500;
const SENT_POLL_MS = 5000;
const LINK_POLL_MS = 1500;
const LINK_POLL_LIMIT = 130; // ~3 minutes: the phone gives one link check up to 3 minutes

let t = translator('en');
let token = readToken();
let queueTimer = null;
let sentTimer = null;

const $ = (id) => document.getElementById(id);

function readToken() {
  try {
    return localStorage.getItem(TOKEN_KEY);
  } catch {
    return null;
  }
}

function writeToken(value) {
  token = value;
  try {
    if (value) localStorage.setItem(TOKEN_KEY, value);
    else localStorage.removeItem(TOKEN_KEY);
  } catch {
    // Private windows may refuse storage: the token then lasts for this page only.
  }
}

class ApiError extends Error {
  constructor(status, body) {
    super(body?.message || `HTTP ${status}`);
    this.status = status;
    this.body = body || {};
  }
}

async function api(method, path, body) {
  const headers = {};
  if (token) headers.Authorization = `Bearer ${token}`;
  const init = { method, headers, cache: 'no-store' };
  if (method === 'POST') {
    headers['Content-Type'] = 'application/json';
    init.body = JSON.stringify(body ?? {});
  }
  let response;
  try {
    response = await fetch(`/api/v1/${path}`, init);
  } catch {
    showGlobal(t('unreachable'));
    throw new ApiError(0, null);
  }
  showGlobal('');
  const data = await response.json().catch(() => null);
  if (response.status === 401 && path !== 'pair') {
    writeToken(null);
    showPairing();
  }
  if (!response.ok) throw new ApiError(response.status, data);
  return data;
}

function showGlobal(text) {
  $('global-message').textContent = text;
}

function setMessage(id, text, tone = '') {
  const element = $(id);
  element.textContent = text;
  element.className = `message ${tone}`.trim();
}

function applyLanguage(language) {
  t = translator(language);
  document.documentElement.lang = language === 'ur' ? 'ur' : 'en';
  document.documentElement.dir = language === 'ur' ? 'rtl' : 'ltr';
  document.title = t('title');
  $('title').textContent = t('title');
  document.querySelectorAll('[data-t]').forEach((element) => {
    element.textContent = t(element.getAttribute('data-t'));
  });
  document.querySelectorAll('[data-placeholder]').forEach((element) => {
    element.setAttribute('placeholder', t(element.getAttribute('data-placeholder')));
  });
}

function showPairing() {
  stopPolling();
  $('main-view').hidden = true;
  $('pair-view').hidden = false;
  $('pin').focus();
}

function showMain() {
  $('pair-view').hidden = true;
  $('main-view').hidden = false;
  startPolling();
}

async function pair(pin) {
  if (!/^\d{6}$/.test(pin)) {
    setMessage('pair-message', t('invalidPin'), 'error');
    return;
  }
  const button = $('pair-button');
  button.disabled = true;
  setMessage('pair-message', t('pairing'));
  try {
    const result = await api('POST', 'pair', { pin, name: deviceName(navigator.userAgent) });
    writeToken(result.token);
    setMessage('pair-message', '');
    $('pin').value = '';
    showMain();
  } catch (error) {
    if (!(error instanceof ApiError) || error.status === 0) return;
    const body = error.body;
    if (body.error === 'wrong_pin') setMessage('pair-message', t('wrongPin', { count: body.attemptsLeft }), 'error');
    else if (body.error === 'locked') setMessage('pair-message', t('locked', { seconds: body.retryAfterSeconds }), 'error');
    else if (body.error === 'pairing_closed') setMessage('pair-message', t('pairingClosed'), 'error');
    else setMessage('pair-message', t('invalidPin'), 'error');
  } finally {
    button.disabled = false;
  }
}

function stopPolling() {
  clearTimeout(queueTimer);
  clearTimeout(sentTimer);
  queueTimer = null;
  sentTimer = null;
}

function startPolling() {
  stopPolling();
  void refreshQueue();
  void refreshSent();
}

async function refreshQueue() {
  clearTimeout(queueTimer);
  if (!token) return;
  try {
    const data = await api('GET', 'downloads');
    renderQueue(data.downloads || []);
  } catch {
    // Shown by api(); polling goes on so the page recovers when the phone is back.
  }
  if (token) queueTimer = setTimeout(refreshQueue, document.hidden ? QUEUE_POLL_MS * 4 : QUEUE_POLL_MS);
}

async function refreshSent() {
  clearTimeout(sentTimer);
  if (!token) return;
  try {
    const data = await api('GET', 'sent');
    renderSent(data.items || []);
  } catch {
    // As above.
  }
  if (token) sentTimer = setTimeout(refreshSent, document.hidden ? SENT_POLL_MS * 4 : SENT_POLL_MS);
}

function element(tag, className, text) {
  const node = document.createElement(tag);
  if (className) node.className = className;
  if (text != null) node.textContent = text;
  return node;
}

const QUEUE_ACTIONS = ['pause', 'resume', 'retry', 'cancel'];

/** The words under a download's title. */
function queueMeta(item) {
  const parts = [t(stateKey(item.state))];
  const pct = percent(item.fraction);
  if (pct != null && item.state !== 'completed') parts.push(`${pct}%`);
  if (item.totalBytes) parts.push(t('progressBytes', { done: formatBytes(item.bytesDone), total: formatBytes(item.totalBytes) }));
  else if (item.bytesDone) parts.push(formatBytes(item.bytesDone));
  const speed = formatSpeed(item.speedBps);
  const eta = formatEta(item.etaSeconds);
  if (speed && eta) parts.push(t('speedEta', { speed, eta }));
  else if (speed) parts.push(speed);
  if (item.quality) parts.push(item.quality);
  return parts.join(' · ');
}

function queueRow() {
  const row = element('li');
  const title = element('div', 'item-title');
  const meta = element('div', 'item-meta');
  const bar = element('div', 'bar');
  const fill = element('span');
  bar.append(fill);
  bar.setAttribute('role', 'progressbar');
  bar.setAttribute('aria-valuemin', '0');
  bar.setAttribute('aria-valuemax', '100');
  const actions = element('div', 'actions');
  row.append(title, meta, bar, actions);
  return { row, title, meta, bar, fill, actions, actionKey: null, item: null };
}

// Rows are kept per download id and updated in place: rebuilding them on every poll would swap a button out from
// under a click that spans a refresh.
const queueRows = new Map();

function renderQueue(downloads) {
  const list = $('queue');
  $('queue-empty').hidden = downloads.length > 0;
  const keep = new Set();
  downloads.forEach((item, index) => {
    keep.add(item.id);
    let entry = queueRows.get(item.id);
    if (!entry) {
      entry = queueRow();
      queueRows.set(item.id, entry);
    }
    entry.item = item;
    entry.row.dataset.id = item.id;
    entry.title.textContent = item.title || item.id;
    entry.meta.textContent = queueMeta(item);
    const pct = percent(item.fraction);
    const showBar = pct != null && item.state !== 'completed' && item.state !== 'cancelled';
    entry.bar.hidden = !showBar;
    if (showBar) {
      entry.fill.style.width = `${pct}%`;
      entry.bar.setAttribute('aria-valuenow', String(pct));
    }
    const actions = (item.actions || []).filter((action) => QUEUE_ACTIONS.includes(action));
    const actionKey = actions.join(',');
    if (actionKey !== entry.actionKey) {
      entry.actionKey = actionKey;
      entry.actions.replaceChildren();
      for (const action of actions) {
        const button = element('button', action === 'cancel' ? 'secondary' : '', t(action));
        button.type = 'button';
        button.addEventListener('click', () => void downloadAction(entry.item, action, button));
        entry.actions.append(button);
      }
      entry.actions.hidden = actions.length === 0;
    }
    if (list.children[index] !== entry.row) list.insertBefore(entry.row, list.children[index] ?? null);
  });
  for (const [id, entry] of queueRows) {
    if (!keep.has(id)) {
      entry.row.remove();
      queueRows.delete(id);
    }
  }
}

async function downloadAction(item, action, button) {
  if (action === 'cancel' && !confirm(t('cancelConfirm', { title: item.title || item.id }))) return;
  button.disabled = true;
  try {
    await api('POST', `downloads/${encodeURIComponent(item.id)}/${action}`);
  } catch (error) {
    if (error instanceof ApiError && error.status !== 0 && error.status !== 401) showGlobal(t('actionFailed'));
  }
  button.disabled = false;
  void refreshQueue();
}

let sentKey = null;

function renderSent(items) {
  const key = JSON.stringify(items);
  if (key === sentKey) return;
  sentKey = key;
  const list = $('sent');
  list.replaceChildren();
  $('sent-empty').hidden = items.length > 0;
  for (const item of items) {
    const row = element('li');
    row.append(element('div', 'item-title', item.title));
    const meta = [];
    const link = safeHttpUrl(item.url);
    if (link) meta.push(new URL(link).host);
    if (item.hasFile && item.sizeBytes) meta.push(formatBytes(item.sizeBytes));
    if (meta.length) row.append(element('div', 'item-meta', meta.join(' · ')));

    const actions = element('div', 'actions');
    if (item.hasFile) {
      const download = element('button', '', t('downloadFile'));
      download.type = 'button';
      download.addEventListener('click', () => void downloadSentFile(item, download));
      actions.append(download);
    }
    if (link) {
      const open = element('a', '', t('openLink'));
      open.href = link;
      open.target = '_blank';
      open.rel = 'noopener noreferrer';
      actions.append(open);
    }
    const remove = element('button', 'secondary', t('remove'));
    remove.type = 'button';
    remove.addEventListener('click', async () => {
      remove.disabled = true;
      try {
        await api('DELETE', `sent/${encodeURIComponent(item.id)}`);
      } catch {
        // Refreshed below either way.
      }
      void refreshSent();
    });
    actions.append(remove);
    row.append(actions);
    list.append(row);
  }
}

async function downloadSentFile(item, button) {
  button.disabled = true;
  try {
    const { href } = await api('POST', `sent/${encodeURIComponent(item.id)}/ticket`);
    if (typeof href === 'string' && href.startsWith('/files/')) {
      const anchor = element('a');
      anchor.href = href;
      anchor.rel = 'noopener';
      document.body.append(anchor);
      anchor.click();
      anchor.remove();
    }
  } catch (error) {
    if (error instanceof ApiError && error.status === 404) showGlobal(t('fileGone'));
  } finally {
    button.disabled = false;
  }
}

async function addLink(value) {
  const url = linkFromInput(value);
  if (!url) {
    setMessage('add-message', t('addInvalid'), 'error');
    return;
  }
  let request;
  try {
    request = await api('POST', 'downloads', { url, source: 'web' });
  } catch (error) {
    if (error instanceof ApiError && error.body.error === 'busy') setMessage('add-message', t('addBusy'), 'error');
    else if (error instanceof ApiError && error.status === 400) setMessage('add-message', t('addInvalid'), 'error');
    return;
  }
  $('link').value = '';
  setMessage('add-message', t(request.status === 'waiting_for_app' ? 'addWaiting' : 'addChecking'));
  for (let i = 0; i < LINK_POLL_LIMIT && isLinkPending(request.status); i += 1) {
    await new Promise((resolve) => setTimeout(resolve, LINK_POLL_MS));
    try {
      request = await api('GET', `links/${encodeURIComponent(request.requestId)}`);
    } catch {
      return;
    }
  }
  if (isLinkPending(request.status)) return;
  const tone = request.status === 'added' || request.status === 'duplicate' ? 'ok' : 'error';
  setMessage('add-message', t(`outcome_${request.status}`, { title: request.title || url }), tone);
  void refreshQueue();
}

async function start() {
  try {
    const info = await api('GET', 'info');
    applyLanguage(info.language);
  } catch {
    applyLanguage('en');
  }
  $('pair-form').addEventListener('submit', (event) => {
    event.preventDefault();
    void pair($('pin').value.trim());
  });
  $('add-form').addEventListener('submit', (event) => {
    event.preventDefault();
    void addLink($('link').value);
  });
  $('pause-all').addEventListener('click', async () => {
    await api('POST', 'queue/pause-all').catch(() => {});
    void refreshQueue();
  });
  $('resume-all').addEventListener('click', async () => {
    await api('POST', 'queue/resume-all').catch(() => {});
    void refreshQueue();
  });
  $('unpair').addEventListener('click', async () => {
    if (!confirm(t('unpairConfirm'))) return;
    await api('POST', 'unpair').catch(() => {});
    writeToken(null);
    showPairing();
  });
  document.addEventListener('visibilitychange', () => {
    if (!document.hidden && token) startPolling();
  });

  // A QR code from the phone carries the PIN after '#', which never reaches the server's logs.
  const scannedPin = pinFromHash(location.hash);
  if (scannedPin) history.replaceState(null, '', location.pathname);
  if (token) {
    showMain();
  } else {
    showPairing();
    if (scannedPin) {
      $('pin').value = scannedPin;
      void pair(scannedPin);
    }
  }
}

void start();
