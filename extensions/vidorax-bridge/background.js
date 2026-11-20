// VidoraX Bridge (P6 #500) — the context-menu items "Send link / video / page to VidoraX".
// The link goes only to the phone the user paired with; nothing else is contacted.

import { loadPairing, sendAndWait } from './lib/api.mjs';
import { outcomeKey, urlToSend } from './lib/core.mjs';
import { languageOf, translator } from './lib/strings.mjs';

// Firefox's promise-based `browser`, else Chrome/Edge's `chrome` (promise-based in MV3 too).
const ext = globalThis.browser ?? globalThis.chrome;
const t = translator(languageOf(globalThis.navigator?.language));

async function createMenus() {
  await Promise.resolve(ext.contextMenus.removeAll()).catch(() => {});
  const ignore = () => void ext.runtime.lastError;
  ext.contextMenus.create({ id: 'send-link', title: t('menuSendLink'), contexts: ['link'] }, ignore);
  ext.contextMenus.create({ id: 'send-video', title: t('menuSendVideo'), contexts: ['video'] }, ignore);
  ext.contextMenus.create({ id: 'send-page', title: t('menuSendPage'), contexts: ['page'] }, ignore);
}

ext.runtime.onInstalled.addListener(createMenus);
ext.runtime.onStartup?.addListener(createMenus);

let badgeTimer = null;

function showResult(ok, message) {
  clearTimeout(badgeTimer);
  ext.action.setBadgeBackgroundColor({ color: ok ? '#1c7c45' : '#b3261e' });
  ext.action.setBadgeText({ text: ok ? '✓' : '!' });
  ext.action.setTitle({ title: `VidoraX Bridge — ${message}` });
  badgeTimer = setTimeout(() => {
    ext.action.setBadgeText({ text: '' });
    ext.action.setTitle({ title: 'VidoraX Bridge' });
  }, 6000);
}

ext.contextMenus.onClicked.addListener(async (info, tab) => {
  const url = urlToSend({
    menuItemId: info.menuItemId,
    linkUrl: info.linkUrl,
    srcUrl: info.srcUrl,
    pageUrl: info.pageUrl ?? tab?.url,
  });
  if (!url) {
    showResult(false, t('sentRefused'));
    return;
  }
  const pairing = await loadPairing(ext.storage.local);
  if (!pairing) {
    showResult(false, t('notPaired'));
    return;
  }
  try {
    const result = await sendAndWait(fetch, pairing, url, { tries: 10 });
    const ok = ['added', 'duplicate', 'checking', 'waiting_for_app'].includes(result.status);
    showResult(ok, t(outcomeKey(result.status)));
  } catch (error) {
    showResult(false, error?.status === 0 ? t('unreachable') : error?.status === 401 ? t('notPaired') : t('sentRefused'));
  }
});
