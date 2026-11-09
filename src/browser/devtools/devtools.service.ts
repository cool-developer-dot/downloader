import { useSyncExternalStore } from 'react';
import { getVidoraWeb, isVidoraWebAvailable } from '@modules/vidorax-web';

import { useBrowserStore } from '@/browser/stores';
import { getTabWebViewTag } from '@/browser/webview/webview-view-tags';
import { subscribeActiveProfile } from '@/storage/profile/active-profile';
import { userScriptsRepository } from '@/storage/repositories/user-scripts.repository';
import { useSettingsStore } from '@/store/settings';

import {
  appendConsole,
  DEFAULT_TAB_DEVTOOLS,
  parseDevtoolsMessage,
  type ConsoleEntry,
  type InspectInfo,
  type NetworkEntry,
  type StorageItem,
  type TabDevtools,
  type UserScript,
} from './devtools-core';

/**
 * B19 — Developer tools state: per tab, in memory only (console, network list, inspected element, source, storage,
 * which user scripts ran, the user agent / device chosen); the profile's user scripts; remote debugging (never
 * remembered, so the next app start has it off). Page messages are kept only while the tools are on.
 */

export type TabDevtoolsData = {
  console: ConsoleEntry[];
  network: { entries: NetworkEntry[]; mixed: number; https: boolean } | null;
  inspect: InspectInfo | null;
  source: { parts: string[]; of: number; truncated: boolean } | null;
  storage: StorageItem[] | null;
  ran: { id: string; state: 'ran' | 'failed' }[];
};

const EMPTY: TabDevtoolsData = { console: [], network: null, inspect: null, source: null, storage: null, ran: [] };

const data = new Map<string, TabDevtoolsData>();
const tabSettings = new Map<string, TabDevtools>();
const injectors = new Map<string, (script: string) => void>();
let scripts: UserScript[] = [];
let remoteDebugging = false;
let panelTabId: string | null = null;
let panelSection = 'console';
// #222: the panel stepped aside for a tap on this tab's page; the element's report brings it back on Inspect.
let inspectWaitingTab: string | null = null;
let version = 0;
const listeners = new Set<() => void>();

function emit(): void {
  version += 1;
  for (const listener of listeners) listener();
}

function subscribe(listener: () => void): () => void {
  listeners.add(listener);
  return () => {
    listeners.delete(listener);
  };
}

export function useDevtoolsVersion(): number {
  return useSyncExternalStore(subscribe, () => version, () => version);
}

export function isDevtoolsEnabled(): boolean {
  return useSettingsStore.getState().devTools === true;
}

export function getTabData(tabId: string | null | undefined): TabDevtoolsData {
  return (tabId && data.get(tabId)) || EMPTY;
}

function update(tabId: string, change: (current: TabDevtoolsData) => TabDevtoolsData): void {
  data.set(tabId, change(data.get(tabId) ?? EMPTY));
  emit();
}

/**
 * BrowserWebView: a page message. True when it was a devtools message (handled here: kept while the tools are on,
 * dropped while off). A page can forge these; they are only shown.
 */
export function handleDevtoolsMessage(tabId: string | undefined, raw: string): boolean {
  const message = parseDevtoolsMessage(raw);
  if (!message) return false;
  if (!tabId || !isDevtoolsEnabled()) return true;
  switch (message.kind) {
    case 'console':
      update(tabId, (d) => ({ ...d, console: appendConsole(d.console, message.entries) }));
      break;
    case 'eval':
      update(tabId, (d) => ({
        ...d,
        console: appendConsole(d.console, [{ level: message.ok ? 'result' : 'error', text: message.text, at: Date.now() }]),
      }));
      break;
    case 'network':
      update(tabId, (d) => ({ ...d, network: { entries: message.entries, mixed: message.mixed, https: message.https } }));
      break;
    case 'inspect':
      update(tabId, (d) => ({ ...d, inspect: message.info }));
      if (inspectWaitingTab === tabId) {
        inspectWaitingTab = null;
        panelSection = 'inspect';
        panelTabId = tabId;
        emit();
      }
      break;
    case 'source':
      update(tabId, (d) => {
        const parts = d.source && d.source.of === message.of ? [...d.source.parts] : [];
        parts[message.part] = message.text;
        return { ...d, source: { parts, of: message.of, truncated: message.truncated } };
      });
      break;
    case 'storage':
      update(tabId, (d) => ({ ...d, storage: message.items }));
      break;
    case 'userscript':
      // Only ids of the user's own scripts are shown.
      if (!scripts.some((s) => s.id === message.id)) break;
      update(tabId, (d) => ({ ...d, ran: [...d.ran.filter((r) => r.id !== message.id), { id: message.id, state: message.state }] }));
      break;
  }
  return true;
}

/** A new page starts in a tab: what devtools showed for the old page goes (as browsers clear the console). */
export function resetTabPage(tabId: string): void {
  if (!data.has(tabId)) return;
  update(tabId, () => EMPTY);
}

export function clearConsole(tabId: string): void {
  update(tabId, (d) => ({ ...d, console: [] }));
}

export function forgetTab(tabId: string): void {
  data.delete(tabId);
  tabSettings.delete(tabId);
  injectors.delete(tabId);
}

// ---- running commands in a tab's page ----

export function bindDevtoolsInjector(tabId: string, inject: (script: string) => void): () => void {
  injectors.set(tabId, inject);
  return () => {
    if (injectors.get(tabId) === inject) injectors.delete(tabId);
  };
}

/** Runs a command in the tab's page (only while the tools are on). False when the page can't be reached. */
export function runInPage(tabId: string, script: string): boolean {
  if (!isDevtoolsEnabled()) return false;
  const inject = injectors.get(tabId);
  if (!inject) return false;
  inject(script);
  return true;
}

// ---- user agent and device (per tab) ----

export function getTabDevtools(tabId: string | null | undefined): TabDevtools {
  return (tabId && tabSettings.get(tabId)) || DEFAULT_TAB_DEVTOOLS;
}

export function useTabDevtools(tabId: string | null | undefined): TabDevtools {
  useDevtoolsVersion();
  return getTabDevtools(tabId);
}

/** Applies on the tab's next load (BrowserWebView reloads after the new user agent is set). */
export function setTabDevtools(tabId: string, next: TabDevtools): void {
  tabSettings.set(tabId, next);
  if (next.uaMode === 'desktop') {
    useBrowserStore.getState().setDesktopMode(true, { source: 'user', tabId });
  } else {
    const tab = useBrowserStore.getState().tabs.find((t) => t.id === tabId);
    if (tab?.desktopMode && tab.desktopModeSource === 'user') {
      useBrowserStore.getState().setDesktopMode(false, { source: 'user', tabId });
    }
  }
  emit();
}

// ---- cookies (#230, native, the tab's own profile) ----

function web() {
  return isVidoraWebAvailable() ? getVidoraWeb() : null;
}

export async function readTabCookies(tabId: string, url: string): Promise<{ name: string; value: string }[]> {
  const tag = getTabWebViewTag(tabId);
  if (tag == null) return [];
  return (await web()?.getTabCookies?.(tag, url).catch(() => [])) ?? [];
}

export async function deleteTabCookie(tabId: string, url: string, name: string | null): Promise<void> {
  const tag = getTabWebViewTag(tabId);
  if (tag == null) return;
  await web()?.deleteTabCookie?.(tag, url, name).catch(() => -1);
}

// ---- remote debugging (#228) ----

export function isRemoteDebugging(): boolean {
  return remoteDebugging;
}

export async function setRemoteDebugging(on: boolean): Promise<void> {
  const ok = (await web()?.setRemoteDebugging?.(on).catch(() => !on)) ?? false;
  remoteDebugging = on && ok;
  emit();
}

// ---- user scripts (#199) ----

export function getUserScripts(): UserScript[] {
  return scripts;
}

export function useUserScripts(): UserScript[] {
  useDevtoolsVersion();
  return scripts;
}

export async function reloadUserScripts(): Promise<void> {
  scripts = await userScriptsRepository.list().catch(() => [] as UserScript[]);
  emit();
}

export async function saveUserScript(script: UserScript): Promise<void> {
  await userScriptsRepository.save(script);
  await reloadUserScripts();
}

export async function deleteUserScript(id: string): Promise<void> {
  await userScriptsRepository.remove(id);
  await reloadUserScripts();
}

// ---- the panel ----

export function openDevtoolsPanel(tabId: string): void {
  panelTabId = tabId;
  emit();
}

export function closeDevtoolsPanel(): void {
  panelTabId = null;
  emit();
}

export function getPanelSection(): string {
  return panelSection;
}

export function setPanelSection(section: string): void {
  panelSection = section;
}

/** #222: hides the panel so the user can tap the page; the tapped element's report reopens it on Inspect. */
export function awaitInspectTap(tabId: string): void {
  inspectWaitingTab = tabId;
  panelTabId = null;
  emit();
}

export function useDevtoolsPanelTab(): string | null {
  useDevtoolsVersion();
  return panelTabId;
}

let stop: (() => void) | null = null;

/** Idempotent; the browser screen starts it. Loads the profile's scripts (again on a profile switch). */
export function ensureDevtools(): () => void {
  if (stop) return stop;
  void reloadUserScripts();
  const unsubscribeProfile = subscribeActiveProfile(() => void reloadUserScripts());
  const unsubscribeSettings = useSettingsStore.subscribe((next, previous) => {
    if (next.devTools !== previous.devTools) {
      if (!next.devTools) {
        data.clear();
        panelTabId = null;
        if (remoteDebugging) void setRemoteDebugging(false);
      }
      emit();
    }
  });
  stop = () => {
    unsubscribeProfile();
    unsubscribeSettings();
    stop = null;
  };
  return stop;
}
