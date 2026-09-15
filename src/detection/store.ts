/**
 * Detection state: TabMedia per tab (rules in tab-state.ts), the open download sheet, and whether the
 * document-start detector script is installed. Hooks select one tab, so updates to other tabs don't re-render.
 */
import { create } from 'zustand';

import type { NetworkMediaObservation } from '@modules/vidorax-web';

import { applyObservations, type TabLocation } from './network';
import {
  applyMessage,
  changeUrl,
  setItemAvailability,
  startDocument,
  upsertCandidate,
  type CandidateOrigin,
  type TabState,
} from './tab-state';
import type { DetectorMessage, ItemAvailability, PageCandidate } from './types';

export interface MediaSheetTarget {
  tabId: string;
  /** Item to expand when the sheet opens (e.g. a file the page asked to download). */
  focusKey: string | null;
}

interface DetectionState {
  tabs: Record<string, TabState>;
  sheet: MediaSheetTarget | null;
  detectorReady: boolean;
}

const useDetectionStore = create<DetectionState>(() => ({ tabs: {}, sheet: null, detectorReady: false }));

function updateTab(tabId: string, update: (tab: TabState | undefined) => TabState | undefined): void {
  useDetectionStore.setState((state) => {
    const current = state.tabs[tabId];
    const next = update(current);
    if (next === current) {
      return state;
    }
    const tabs = { ...state.tabs };
    if (next) {
      tabs[tabId] = next;
      return { tabs };
    }
    delete tabs[tabId];
    return { tabs, sheet: state.sheet?.tabId === tabId ? null : state.sheet };
  });
}

export function onDocumentStart(tabId: string, url: string): void {
  updateTab(tabId, (tab) => startDocument(tab, url));
}

export function onUrlChange(tabId: string, url: string): void {
  updateTab(tabId, (tab) => changeUrl(tab, url));
}

export function ingestMessage(tabId: string, message: DetectorMessage): void {
  const now = Date.now();
  updateTab(tabId, (tab) =>
    applyMessage(tab ?? startDocument(undefined, message.frame.isMain ? message.frame.url : ''), message, now),
  );
}

export function ingestNetwork(tabId: string, observations: readonly NetworkMediaObservation[]): void {
  const now = Date.now();
  updateTab(tabId, (tab) => tab && applyObservations(tab, observations, now));
}

export function ingestCandidate(tabId: string, candidate: PageCandidate, origin: CandidateOrigin): void {
  const now = Date.now();
  updateTab(tabId, (tab) => tab && upsertCandidate(tab, candidate, origin, now));
}

/** Ignored when the tab has started another document since the resolution began. */
export function setAvailability(
  tabId: string,
  documentId: number,
  key: string,
  revision: number,
  availability: ItemAvailability,
): void {
  updateTab(tabId, (tab) =>
    tab && tab.documentId === documentId ? setItemAvailability(tab, key, revision, availability) : tab,
  );
}

export function clearTabState(tabId: string): void {
  updateTab(tabId, () => undefined);
}

export function getTab(tabId: string): TabState | undefined {
  return useDetectionStore.getState().tabs[tabId];
}

export function tabLocations(): TabLocation[] {
  return Object.entries(useDetectionStore.getState().tabs).map(([tabId, tab]) => ({
    tabId,
    currentUrl: tab.currentUrl,
  }));
}

export function openSheet(tabId: string, focusKey: string | null): void {
  useDetectionStore.setState({ sheet: { tabId, focusKey } });
}

export function closeSheet(): void {
  useDetectionStore.setState({ sheet: null });
}

export function markDetectorReady(): void {
  if (!useDetectionStore.getState().detectorReady) {
    useDetectionStore.setState({ detectorReady: true });
  }
}

export function useTabMediaCount(tabId: string): number {
  return useDetectionStore((state) => state.tabs[tabId]?.order.length ?? 0);
}

export function useTabState(tabId: string): TabState | undefined {
  return useDetectionStore((state) => state.tabs[tabId]);
}

export function useMediaSheetTarget(): MediaSheetTarget | null {
  return useDetectionStore((state) => state.sheet);
}

/** True once the detector script is installed natively (or after a 1.5 s fallback). Mount WebViews after it. */
export function useDetectorReady(): boolean {
  return useDetectionStore((state) => state.detectorReady);
}
