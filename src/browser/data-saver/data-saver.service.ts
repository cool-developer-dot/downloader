import { useSyncExternalStore } from 'react';
import { AppState, type NativeEventSubscription } from 'react-native';
import NetInfo from '@react-native-community/netinfo';

import { getVidoraWeb, isVidoraWebAvailable } from '@modules/vidorax-web';
import { bindBrowserSaversReader } from '@/browser/preload/browser-savers';
import { bindAutoScrollSpeedFactor } from '@/browser/scroll/auto-scroll';
import { useBrowserStore } from '@/browser/stores';
import { bindTabSleepShortener, runTabSleepCheck } from '@/browser/tab-sound/tab-sleep.service';
import { useSettingsStore } from '@/store/settings';

import {
  cappedTabSleepMs,
  imagesOffFor,
  normalizeBatterySaver,
  parseImageExceptions,
  resolveSaverEffects,
  type SaverConditions,
  type SaverEffects,
  type SaverSettings,
} from './data-saver-settings';
import { createSaverNative } from './data-saver-native';

/**
 * B18 — Data saver and performance at runtime: the network (NetInfo; Wi-Fi = Wi-Fi or Ethernet, as B9) and the
 * phone's Battery Saver (VidoraWeb `isPowerSaveMode`, read when the app comes to the front and every minute) feed
 * `resolveSaverEffects`, which answers B6 (preloading), B3 (tab sleep cap), B6's auto scroll (speed share) and B14
 * (`dataSaverWantsNoAutoplay`), and decides each tab's pictures and software layer when its page starts loading.
 */

const POWER_POLL_MS = 60_000;
const LITE_SLEEP_DELAY_MS = 1_500;

let conditions: SaverConditions = { onWifi: false, phonePowerSave: false };
let version = 0;
const listeners = new Set<() => void>();
let started = false;
let stopAll: (() => void) | null = null;

function emit(): void {
  version += 1;
  for (const listener of listeners) {
    try {
      listener();
    } catch {
      // ignore
    }
  }
}

let exceptionsCache: { raw: unknown; list: string[] } = { raw: undefined, list: [] };

export function currentSaverSettings(): SaverSettings {
  const s = useSettingsStore.getState();
  if (exceptionsCache.raw !== s.imageExceptions) {
    exceptionsCache = { raw: s.imageExceptions, list: parseImageExceptions(s.imageExceptions) };
  }
  return {
    blockImages: s.blockImages === true,
    imageExceptions: exceptionsCache.list,
    imagesWifiOnly: s.imagesWifiOnly === true,
    dataSaver: s.dataSaver === true,
    liteMode: s.liteMode === true,
    lightweightHome: s.lightweightHome === true,
    batterySaver: normalizeBatterySaver(s.batterySaver),
    hardwareAcceleration: s.hardwareAcceleration !== false,
  };
}

export function currentSaverEffects(): SaverEffects {
  return resolveSaverEffects(currentSaverSettings(), conditions);
}

/** Whether pictures are off for the page at `url` now (also the reader's pictures). */
export function imagesOffForUrl(url: string): boolean {
  const settings = currentSaverSettings();
  return imagesOffFor(settings, resolveSaverEffects(settings, conditions), conditions, url);
}

/** The named hook for B14 (autoplay): true while Data saver is on. */
export function dataSaverWantsNoAutoplay(): boolean {
  try {
    return currentSaverEffects().autoplayOff;
  } catch {
    return false;
  }
}

export const saverNative = createSaverNative(() => (isVidoraWebAvailable() ? getVidoraWeb() : null));

/** A page starts loading in the WebView `viewTag`: its pictures and layer for that page. */
export function applySaverNative(viewTag: number | null, url: string): void {
  if (viewTag == null) return;
  const effects = currentSaverEffects();
  saverNative.applyImages(viewTag, imagesOffForUrl(url));
  saverNative.applySoftware(viewTag, effects.softwareLayer);
}

function readPowerSave(): void {
  let on = false;
  try {
    on = isVidoraWebAvailable() ? getVidoraWeb().isPowerSaveMode?.() === true : false;
  } catch {
    on = false;
  }
  if (on !== conditions.phonePowerSave) {
    conditions = { ...conditions, phonePowerSave: on };
    emit();
  }
}

function setNetwork(type: unknown): void {
  const kind = String(type ?? 'unknown').toLowerCase();
  const onWifi = kind === 'wifi' || kind === 'ethernet';
  if (onWifi !== conditions.onWifi) {
    conditions = { ...conditions, onWifi };
    emit();
  }
}

/** Idempotent; the browser screen starts it. */
export function ensureDataSaver(): () => void {
  if (started && stopAll) return stopAll;
  started = true;
  bindBrowserSaversReader(() => {
    const effects = currentSaverEffects();
    return { dataSaver: effects.dataSaver || effects.lite, batterySaver: effects.battery };
  });
  bindTabSleepShortener((base) => cappedTabSleepMs(base, currentSaverEffects().tabSleepCapMs));
  bindAutoScrollSpeedFactor(() => currentSaverEffects().autoScrollFactor);

  const unsubscribeNet = NetInfo.addEventListener((state) => setNetwork(state.type));
  void NetInfo.fetch()
    .then((state) => setNetwork(state.type))
    .catch(() => undefined);

  readPowerSave();
  let timer: ReturnType<typeof setInterval> | null = setInterval(readPowerSave, POWER_POLL_MS);
  const appState: NativeEventSubscription = AppState.addEventListener('change', (next) => {
    if (next === 'active') {
      readPowerSave();
      if (!timer) timer = setInterval(readPowerSave, POWER_POLL_MS);
    } else if (timer) {
      clearInterval(timer);
      timer = null;
    }
  });

  // Lite mode: one live tab — the others sleep soon after another tab comes to the front or lite turns on.
  let sleepTimer: ReturnType<typeof setTimeout> | null = null;
  const sleepSoon = () => {
    if (!currentSaverEffects().lite) return;
    if (sleepTimer) clearTimeout(sleepTimer);
    sleepTimer = setTimeout(() => {
      sleepTimer = null;
      if (currentSaverEffects().lite) runTabSleepCheck();
    }, LITE_SLEEP_DELAY_MS);
  };
  const unsubscribeTabs = useBrowserStore.subscribe((next, previous) => {
    if (next.activeTabId !== previous.activeTabId || next.mountedTabIds !== previous.mountedTabIds) sleepSoon();
  });
  const unsubscribeSettings = useSettingsStore.subscribe((next, previous) => {
    if (
      next.blockImages !== previous.blockImages ||
      next.imageExceptions !== previous.imageExceptions ||
      next.imagesWifiOnly !== previous.imagesWifiOnly ||
      next.dataSaver !== previous.dataSaver ||
      next.liteMode !== previous.liteMode ||
      next.lightweightHome !== previous.lightweightHome ||
      next.batterySaver !== previous.batterySaver ||
      next.hardwareAcceleration !== previous.hardwareAcceleration
    ) {
      emit();
    }
  });
  const unsubscribeSelf = subscribe(sleepSoon);

  stopAll = () => {
    unsubscribeNet();
    appState.remove();
    if (timer) clearInterval(timer);
    timer = null;
    if (sleepTimer) clearTimeout(sleepTimer);
    unsubscribeTabs();
    unsubscribeSettings();
    unsubscribeSelf();
    bindTabSleepShortener(null);
    bindAutoScrollSpeedFactor(null);
    bindBrowserSaversReader(() => ({ dataSaver: false, batterySaver: false }));
    started = false;
    stopAll = null;
  };
  return stopAll;
}

function subscribe(listener: () => void): () => void {
  listeners.add(listener);
  return () => {
    listeners.delete(listener);
  };
}

const getVersion = () => version;

/** The saver effects now; re-renders on a setting, network or Battery Saver change. */
export function useSaverEffects(): SaverEffects {
  useSyncExternalStore(subscribe, getVersion, getVersion);
  // Settings changes re-render through the store too (the subscription above only covers started services).
  useSettingsStore((s) => `${s.dataSaver}|${s.liteMode}|${s.lightweightHome}|${s.batterySaver}|${s.hardwareAcceleration}|${s.imagesWifiOnly}|${s.blockImages}`);
  return currentSaverEffects();
}

/** Whether the reader / a page at `url` shows pictures now; re-renders on changes. */
export function useImagesOffFor(url: string): boolean {
  useSyncExternalStore(subscribe, getVersion, getVersion);
  useSettingsStore((s) => `${s.dataSaver}|${s.liteMode}|${s.imagesWifiOnly}|${s.blockImages}|${s.imageExceptions}`);
  return imagesOffForUrl(url);
}
