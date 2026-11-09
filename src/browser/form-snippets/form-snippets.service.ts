import { useSyncExternalStore } from 'react';

import { insertSnippetScript, parseFieldMessage, type FieldKind } from './form-snippets';

/**
 * B22 #274 — which page field has focus (its kind only, per tab) and the tab in front's way to insert a snippet.
 * BrowserWebView passes the page's messages here and binds the inserter while its tab is in front.
 */

type Field = { tabId: string; kind: FieldKind } | null;

let field: Field = null;
let version = 0;
const listeners = new Set<() => void>();
let inserter: { tabId: string; inject: (script: string) => void } | null = null;

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

export function useFocusedFormField(): Field {
  useSyncExternalStore(subscribe, () => version, () => version);
  return field;
}

/** True when `raw` was a form-field message (handled here). */
export function handleFormFieldMessage(tabId: string | undefined, raw: string): boolean {
  const message = parseFieldMessage(raw);
  if (!message) return false;
  if (!tabId) return true;
  const next = message.kind ? { tabId, kind: message.kind } : null;
  if (next?.kind !== field?.kind || next?.tabId !== field?.tabId) {
    if (next || field?.tabId === tabId) {
      field = next;
      emit();
    }
  }
  return true;
}

export function bindSnippetInserter(tabId: string, inject: (script: string) => void): () => void {
  inserter = { tabId, inject };
  return () => {
    if (inserter?.tabId === tabId) inserter = null;
    if (field?.tabId === tabId) {
      field = null;
      emit();
    }
  };
}

/** Inserts the snippet into the focused field of the tab in front (only on the user's tap). */
export function insertSnippet(text: string): void {
  if (!field || !inserter || inserter.tabId !== field.tabId) return;
  inserter.inject(insertSnippetScript(text));
}
