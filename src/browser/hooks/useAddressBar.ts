import { useCallback, useEffect, useRef, useState } from 'react';
import { AccessibilityInfo, Keyboard, Platform, ToastAndroid, type TextInput } from 'react-native';
import * as Clipboard from 'expo-clipboard';
import { useFocusEffect } from 'expo-router';

import { addressBarVisibility } from '@/browser/address-bar/address-bar-visibility';
import { escapePanels } from '@/browser/startup/escape-panels';
import { registrableDomain } from '@/browser/address-bar/domain';
import { pagePreload } from '@/browser/preload/page-preload.service';
import { prefetchHostFor } from '@/browser/preload/preload-policy';
import {
  completionOnSelection,
  inlineCompletion,
  rankAutocompleteHosts,
  type RankedHost,
} from '@/browser/address-bar/inline-autocomplete';
import { suggestionService } from '@/browser/suggestions';

import { useOmniboxSuggestions } from '@/browser/hooks/useOmniboxSuggestions';
import { loadUrlActiveTab, navigationService } from '@/browser/services';
import {
  subscribeAddressBarFocusRequest,
  takeAddressBarFocusRequest,
} from '@/browser/services/address-bar-focus';
import { isYouTubeLink, openPastedLink } from '@/browser/services/pasted-link.service';
import { announceYouTubeNotSupported } from '@/browser/services/youtube-refusal';
import type { OmniboxSuggestion } from '@/browser/suggestions';
import {
  selectActiveTabId,
  selectCurrentUrl,
  selectIsHome,
  selectIsLoading,
  useBrowserStore,
} from '@/browser/stores';
import { formatDisplayUrl, isBrowserHomeUrl } from '@/browser/utils';
import { translate } from '@/localization';
import { useRecentSearchesStore } from '@/store/recent-searches';
import { useSettingsStore } from '@/store/settings';
import { isIncognitoInFront } from '@/browser/incognito/incognito-state';

/**
 * Premium omnibox controller.
 * Draft editing stays local until a successful submit / suggestion selection.
 * Phase 3A freeze: draft is ephemeral — discarded on tab switch.
 */
export function useAddressBar() {
  const currentUrl = useBrowserStore(selectCurrentUrl);
  const isHome = useBrowserStore(selectIsHome);
  const isLoading = useBrowserStore(selectIsLoading);
  const activeTabId = useBrowserStore(selectActiveTabId);
  const recordRecentSearch = useRecentSearchesStore((state) => state.record);
  const inputRef = useRef<TextInput>(null);
  /** Prevents double-fire from Android Go + onKeyPress / rapid Enter. */
  const submitLockRef = useRef(false);

  const [isFocused, setIsFocused] = useState(false);
  const [draft, setDraft] = useState('');
  /** B5 "Search this site": the prefilled text keeps the caret at its end instead of being selected. */
  const [caretAtEnd, setCaretAtEnd] = useState(false);
  const [validationMessage, setValidationMessage] = useState<string | null>(null);
  /** B4 #24: the typed text plus the site completed inline (its added part shown selected); null when none. */
  const [completion, setCompletion] = useState<string | null>(null);
  const autocompleteHostsRef = useRef<readonly RankedHost[]>([]);
  /** With the caret moved into the text nothing is completed (B4: never in the middle). */
  const caretAtEndRef = useRef(true);
  const localSuggestions = useSettingsStore((state) => state.searchSuggestions !== false);

  const { suggestions, loading: suggestionsLoading, clearSuggestions } =
    useOmniboxSuggestions({
      enabled: isFocused,
      query: draft,
    });

  // The sites inline autocomplete may complete: loaded once per editing session from the local index.
  useEffect(() => {
    if (!isFocused || !localSuggestions) {
      autocompleteHostsRef.current = [];
      return;
    }
    let cancelled = false;
    void suggestionService
      .getAutocompleteSources()
      .then((sources) => {
        if (!cancelled) {
          autocompleteHostsRef.current = rankAutocompleteHosts(sources, registrableDomain);
        }
      })
      .catch(() => undefined);
    return () => {
      cancelled = true;
    };
  }, [isFocused, localSuggestions]);

  // B6 #55 Preload pages: the top suggestion's site is looked up while the user is still typing.
  useEffect(() => {
    if (!isFocused) return undefined;
    const host = prefetchHostFor(suggestions[0]);
    if (!host) return undefined;
    const timer = setTimeout(() => pagePreload.prefetchHost(host), 250);
    return () => clearTimeout(timer);
  }, [isFocused, suggestions]);

  // Discard unfinished draft when switching tabs: the editing state is reset while rendering the new tab
  // (React's "adjust state when a prop changes"), the keyboard and suggestions below.
  const [draftTabId, setDraftTabId] = useState(activeTabId);
  if (draftTabId !== activeTabId) {
    setDraftTabId(activeTabId);
    setDraft('');
    setCompletion(null);
    setValidationMessage(null);
    setIsFocused(false);
  }

  useEffect(() => {
    clearSuggestions();
    Keyboard.dismiss();
    inputRef.current?.blur();
  }, [activeTabId, clearSuggestions]);

  // B4 #29: an address bar being edited is never hidden.
  useEffect(() => {
    addressBarVisibility.setEditing(isFocused);
  }, [isFocused]);

  // B21 #246: while the address bar is being edited, Esc (physical keyboard) closes it.
  useEffect(() => {
    if (!isFocused) return undefined;
    return escapePanels.open('addressBar', () => inputRef.current?.blur());
  }, [isFocused]);

  const displayValue = isFocused
    ? draft
    : isHome
      ? ''
      : formatDisplayUrl(currentUrl);

  const dismissEditing = useCallback(() => {
    setIsFocused(false);
    setCompletion(null);
    setValidationMessage(null);
    clearSuggestions();
    Keyboard.dismiss();
    inputRef.current?.blur();
  }, [clearSuggestions]);

  const navigateTo = useCallback(
    (url: string, options?: { recordSearchQuery?: string; typedLink?: boolean }) => {
      setValidationMessage(null);
      // A typed or pasted YouTube link is refused where it was entered: no navigation, no page fetch.
      if (options?.typedLink && isYouTubeLink(url)) {
        // The suggestion list covers the message under the field: close it so the message shows.
        clearSuggestions();
        setValidationMessage(announceYouTubeNotSupported());
        return false;
      }
      // Canonical path: same owner as home shortcut icons (registry loadUrl). A link the user typed or pasted is read
      // by the direct analyzer first (see pasted-link.service), then loaded the same way.
      const loaded = options?.typedLink ? openPastedLink(url, { source: 'omnibox' }) : loadUrlActiveTab(url);
      if (!loaded) {
        setValidationMessage(translate('browser.addressInvalid'));
        return false;
      }

      dismissEditing();

      // B11: a search typed in an incognito tab is never kept.
      if (options?.recordSearchQuery?.trim() && !isIncognitoInFront()) {
        void recordRecentSearch(options.recordSearchQuery.trim());
      }
      return true;
    },
    [clearSuggestions, dismissEditing, recordRecentSearch],
  );

  const onChangeText = useCallback(
    (text: string) => {
      setValidationMessage(null);
      // Deleting (Backspace removes the selected completion first) never completes; typing forward does.
      const shownBefore = completion ?? draft;
      const deleting = text.length < shownBefore.length && (completion == null || text.length <= draft.length);
      setDraft(text);
      if (deleting || !localSuggestions) {
        setCompletion(null);
        return;
      }
      setCompletion(
        inlineCompletion(text, autocompleteHostsRef.current, { caretAtEnd: caretAtEndRef.current }),
      );
    },
    [completion, draft, localSuggestions],
  );

  /** The caret moved: the end of a completion or Select all accepts it; into what was typed stops it. */
  const onSelectionChange = useCallback(
    (selection: { start: number; end: number }) => {
      if (completion != null) {
        const move = completionOnSelection(draft, completion, selection);
        if (move === 'accept') {
          setDraft(completion);
          setCompletion(null);
        } else if (move === 'drop') {
          setCompletion(null);
          caretAtEndRef.current = false;
        }
        return;
      }
      caretAtEndRef.current = selection.end >= draft.length;
    },
    [completion, draft],
  );

  const onFocus = useCallback(() => {
    const seed = isBrowserHomeUrl(currentUrl) ? '' : currentUrl;
    setDraft(seed);
    setCompletion(null);
    caretAtEndRef.current = true;
    setCaretAtEnd(false);
    setValidationMessage(null);
    setIsFocused(true);
    submitLockRef.current = false;
  }, [currentUrl]);

  // "Paste link" elsewhere with nothing to paste: open the editor (the overlay focuses its field, keyboard up) once the
  // Browser is on screen.
  useFocusEffect(
    useCallback(() => {
      const timers: ReturnType<typeof setTimeout>[] = [];
      const focusIfRequested = () => {
        const request = takeAddressBarFocusRequest();
        if (!request) {
          return;
        }
        // After the tab transition, so the keyboard opens over the Browser, not the screen it came from.
        timers.push(
          setTimeout(() => {
            onFocus();
            if (request.prefill != null) {
              setDraft(request.prefill);
              setCaretAtEnd(true);
            }
          }, 300),
        );
        // The overlay focuses its field as it appears, before Android serves that field to the keyboard, so that
        // first request for the keyboard is dropped (a tap does not hit this). Focusing it again once it is served
        // opens the keyboard; React Native ignores focus() on the field that already has focus, hence the blur.
        timers.push(setTimeout(() => inputRef.current?.blur(), 800));
        timers.push(setTimeout(() => inputRef.current?.focus(), 900));
        // A prefill ("site:example.com ") keeps the caret at its end once the field has its final focus, so the next
        // words are added to it rather than typed over it.
        const prefill = request.prefill;
        if (prefill != null) {
          timers.push(setTimeout(() => inputRef.current?.setSelection(prefill.length, prefill.length), 1000));
        }
      };
      focusIfRequested();
      const unsubscribe = subscribeAddressBarFocusRequest(focusIfRequested);
      return () => {
        unsubscribe();
        timers.forEach(clearTimeout);
      };
    }, [onFocus]),
  );

  const onBlur = useCallback(() => {
    // Keep focus state until explicit dismiss / submit so the overlay can receive taps.
  }, []);

  const clear = useCallback(() => {
    setDraft('');
    setCompletion(null);
    setValidationMessage(null);
    inputRef.current?.focus();
  }, []);

  const submit = useCallback(() => {
    if (submitLockRef.current) {
      return;
    }

    // Enter accepts an inline completion.
    const text = completion ?? draft;
    const result = navigationService.resolveSubmission(text);

    if (!result.ok) {
      if (result.intent.kind === 'empty') {
        setValidationMessage(translate('browser.addressEmpty'));
      } else if (result.intent.kind === 'blocked') {
        setValidationMessage(translate('browser.addressBlocked'));
      } else {
        setValidationMessage(translate('browser.addressInvalid'));
      }
      return;
    }

    submitLockRef.current = true;
    const shouldRecordSearch = result.intent.kind === 'search';
    const ok = navigateTo(result.url, {
      recordSearchQuery: shouldRecordSearch ? text : undefined,
      typedLink: result.intent.kind === 'navigate',
    });
    if (!ok) {
      submitLockRef.current = false;
      return;
    }
    // Allow a later intentional submit after keyboard settles.
    setTimeout(() => {
      submitLockRef.current = false;
    }, 500);
  }, [completion, draft, navigateTo]);

  const selectSuggestion = useCallback(
    (item: OmniboxSuggestion) => {
      // B4 #268: the calculator row copies its result; it never navigates.
      if (item.kind === 'calculator') {
        const result = item.title.replace(/^=\s*/, '');
        void Clipboard.setStringAsync(result);
        const message = translate('browserAddress.copiedResult', { result });
        if (Platform.OS === 'android') {
          ToastAndroid.show(message, ToastAndroid.SHORT);
        }
        AccessibilityInfo.announceForAccessibility(message);
        return;
      }
      if (submitLockRef.current) {
        return;
      }
      submitLockRef.current = true;
      const shouldRecordSearch =
        item.kind === 'search' || item.kind === 'recent_search';

      const ok = navigateTo(item.url, {
        recordSearchQuery: shouldRecordSearch
          ? item.kind === 'recent_search'
            ? item.title
            : draft
          : undefined,
        // The row for exactly what was typed or pasted.
        typedLink: item.kind === 'exact_url',
      });
      if (!ok) {
        submitLockRef.current = false;
        return;
      }
      setTimeout(() => {
        submitLockRef.current = false;
      }, 500);
    },
    [draft, navigateTo],
  );

  const dismissSuggestions = useCallback(() => {
    dismissEditing();
  }, [dismissEditing]);

  return {
    inputRef,
    value: displayValue,
    draft,
    isFocused,
    isLoading: isLoading && !isHome,
    showClear: isFocused && draft.length > 0,
    showSecurity: !isFocused && !isHome,
    validationMessage,
    suggestions,
    suggestionsLoading,
    showSuggestions: isFocused,
    caretAtEnd,
    /** What the focused field shows: the typed text, or typed + the inline completion. */
    inputValue: completion ?? draft,
    /** The completed part, selected — so typing on replaces it and Backspace removes it. */
    inputSelection: completion != null ? { start: draft.length, end: completion.length } : undefined,
    onSelectionChange,
    onChangeText,
    onFocus,
    onBlur,
    clear,
    submit,
    selectSuggestion,
    dismissSuggestions,
  };
}
