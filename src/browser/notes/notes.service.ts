import { useSyncExternalStore } from 'react';
import { AccessibilityInfo, Platform, ToastAndroid } from 'react-native';
import * as Crypto from 'expo-crypto';

import { isIncognitoTabId } from '@/browser/incognito/incognito-state';
import { useBrowserStore } from '@/browser/stores';
import { isValidBrowserPageUrl } from '@/browser/utils';
import { translate } from '@/localization';
import { notesRepository, type Note } from '@/storage/repositories/notes.repository';

/**
 * B22 #252 — Save to notes: from the text-selection menu (the selected text, the page's title and address) or Menu →
 * "Save page to notes". Notes live in the browser profile's database. Never saved from an incognito tab
 * (`shouldPersistForTab` false), only a notice.
 */

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

/** Re-renders when notes change (the Notes screen reloads its list). */
export function useNotesVersion(): number {
  return useSyncExternalStore(subscribe, () => version, () => version);
}

function notify(message: string): void {
  if (Platform.OS === 'android') ToastAndroid.show(message, ToastAndroid.SHORT);
  AccessibilityInfo.announceForAccessibility(message);
}

function pageOf(tabId: string | null | undefined): { tabId: string; url: string; title: string } | null {
  const state = useBrowserStore.getState();
  const id = tabId ?? state.activeTabId;
  const tab = state.tabs.find((t) => t.id === id);
  return tab ? { tabId: tab.id, url: tab.url, title: tab.title } : null;
}

/** Saves `text` with the page it came from; false when nothing was saved (incognito, empty). */
export async function saveNote(text: string, fromTabId?: string | null): Promise<boolean> {
  const page = pageOf(fromTabId);
  if (isIncognitoTabId(page?.tabId)) {
    notify(translate('browserShare.noteNotSavedIncognito'));
    return false;
  }
  const body = text.trim();
  if (!body) return false;
  const url = page && isValidBrowserPageUrl(page.url) ? page.url : '';
  try {
    await notesRepository.add({ id: Crypto.randomUUID(), text: body, pageUrl: url, pageTitle: url ? page?.title ?? '' : '' });
    emit();
    notify(translate('browserShare.noteSaved'));
    return true;
  } catch {
    return false;
  }
}

/** Menu → Save page to notes: the page's title and address. */
export function savePageNote(): Promise<boolean> {
  const page = pageOf(null);
  if (!page || !isValidBrowserPageUrl(page.url)) return Promise.resolve(false);
  return saveNote(page.title?.trim() ? `${page.title.trim()}\n${page.url}` : page.url);
}

export function listNotes(query = ''): Promise<Note[]> {
  return notesRepository.list(query).catch(() => []);
}

export async function updateNote(id: string, text: string): Promise<void> {
  if (!text.trim()) return;
  await notesRepository.update(id, text.trim()).catch(() => false);
  emit();
}

export async function deleteNote(id: string): Promise<void> {
  await notesRepository.remove(id).catch(() => false);
  emit();
}
