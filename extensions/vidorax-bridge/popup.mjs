// VidoraX Bridge popup (P6 #500): pairing with the phone, then the current page's video links.

import { clearPairing, loadPairing, pair, PhoneError, savePairing, sendAndWait, unpair } from './lib/api.mjs';
import { normalizePhoneAddress, originPattern, outcomeKey, pinFromAddress, videoLinksFrom } from './lib/core.mjs';
import { languageOf, translator } from './lib/strings.mjs';

const ext = globalThis.browser ?? globalThis.chrome;
const language = languageOf(navigator.language);
const t = translator(language);
const $ = (id) => document.getElementById(id);

function say(text, tone = '') {
  const message = $('message');
  message.textContent = text;
  message.className = tone;
}

function applyStrings() {
  document.documentElement.lang = language;
  document.documentElement.dir = language === 'ur' ? 'rtl' : 'ltr';
  document.querySelectorAll('[data-t]').forEach((node) => {
    node.textContent = t(node.getAttribute('data-t'));
  });
  document.querySelectorAll('[data-placeholder]').forEach((node) => {
    node.setAttribute('placeholder', t(node.getAttribute('data-placeholder')));
  });
}

function errorText(error) {
  if (!(error instanceof PhoneError) || error.status === 0) return t('unreachable');
  const body = error.body;
  if (body.error === 'wrong_pin') return t('wrongPin', { count: body.attemptsLeft });
  if (body.error === 'locked') return t('locked', { seconds: body.retryAfterSeconds });
  if (body.error === 'pairing_closed') return t('pairingClosed');
  if (error.status === 401) return t('notPaired');
  return t('sentRefused');
}

// Runs inside the page (activeTab): the page's video addresses and links, nothing else.
function collectFromPage() {
  const media = [];
  for (const video of document.querySelectorAll('video')) {
    const label = document.title;
    if (video.currentSrc) media.push({ url: video.currentSrc, label });
    if (video.src) media.push({ url: video.src, label });
    for (const source of video.querySelectorAll('source')) if (source.src) media.push({ url: source.src, label });
  }
  const links = [];
  for (const anchor of Array.from(document.querySelectorAll('a[href]')).slice(0, 2000)) {
    links.push({ url: anchor.href, label: (anchor.textContent || '').trim().slice(0, 120) });
  }
  return { media, links, pageUrl: location.href, title: document.title };
}

async function activeTab() {
  const [tab] = await ext.tabs.query({ active: true, currentWindow: true });
  return tab;
}

async function send(pairing, url, button) {
  if (button) button.disabled = true;
  say(t('sentChecking'));
  try {
    const result = await sendAndWait(fetch, pairing, url);
    const ok = ['added', 'duplicate', 'checking', 'waiting_for_app'].includes(result.status);
    say(t(outcomeKey(result.status)), ok ? 'ok' : 'error');
  } catch (error) {
    say(errorText(error), 'error');
  } finally {
    if (button) button.disabled = false;
  }
}

async function showMain(pairing) {
  $('pair-view').hidden = true;
  $('main-view').hidden = false;
  $('paired-with').textContent = t('pairedWith', { address: pairing.origin });
  const tab = await activeTab();
  $('send-page').onclick = () => tab?.url && void send(pairing, tab.url, $('send-page'));
  $('open-web-ui').onclick = () => void ext.tabs.create({ url: `${pairing.origin}/` });
  $('unpair').onclick = async () => {
    await unpair(fetch, pairing).catch(() => {});
    await clearPairing(ext.storage.local);
    say('');
    showPair();
  };

  let snapshot = null;
  try {
    const [injection] = await ext.scripting.executeScript({ target: { tabId: tab.id }, func: collectFromPage });
    snapshot = injection?.result ?? null;
  } catch {
    say(t('cantReadPage'));
  }
  const videos = videoLinksFrom(snapshot);
  const list = $('videos');
  list.replaceChildren();
  $('no-videos').hidden = videos.length > 0;
  for (const video of videos) {
    const row = document.createElement('li');
    const label = document.createElement('span');
    label.textContent = video.label;
    label.title = video.url;
    const button = document.createElement('button');
    button.type = 'button';
    button.textContent = t('send');
    button.addEventListener('click', () => void send(pairing, video.url, button));
    row.append(label, button);
    list.append(row);
  }
}

function showPair() {
  $('main-view').hidden = true;
  $('pair-view').hidden = false;
  $('address').focus();
}

$('address').addEventListener('input', () => {
  const pin = pinFromAddress($('address').value);
  if (pin && !$('pin').value) $('pin').value = pin;
});

$('pair-form').addEventListener('submit', (event) => {
  event.preventDefault();
  const origin = normalizePhoneAddress($('address').value);
  const pin = $('pin').value.trim();
  if (!origin) {
    say(t('badAddress'), 'error');
    return;
  }
  if (!/^\d{6}$/.test(pin)) {
    say(t('badPin'), 'error');
    return;
  }
  // Asked for inside the click itself: browsers grant optional host access only on a user gesture.
  const granted = ext.permissions.request({ origins: [originPattern(origin)] });
  void (async () => {
    if (!(await granted)) {
      say(t('permissionDenied'), 'error');
      return;
    }
    $('pair-button').disabled = true;
    say(t('pairing'));
    try {
      const pairing = await pair(fetch, origin, pin, navigator.userAgent);
      await savePairing(ext.storage.local, pairing);
      say('');
      await showMain(pairing);
    } catch (error) {
      say(errorText(error), 'error');
    } finally {
      $('pair-button').disabled = false;
    }
  })();
});

applyStrings();
const existing = await loadPairing(ext.storage.local);
if (existing) await showMain(existing);
else showPair();
