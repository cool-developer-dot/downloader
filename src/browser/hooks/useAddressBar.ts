import { useCallback, useEffect, useRef, useState } from 'react';
import { Keyboard, type TextInput } from 'react-native';

import { useOmniboxSuggestions } from '@/browser/hooks/useOmniboxSuggestions';
import { loadUrlActiveTab, navigationService } from '@/browser/services';
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
  const [validationMessage, setValidationMessage] = useState<string | null>(null);

  const { suggestions, loading: suggestionsLoading, clearSuggestions } =
    useOmniboxSuggestions({
      enabled: isFocused,
      query: draft,
    });

  // Discard unfinished draft when switching tabs: the editing state is reset while rendering the new tab
  // (React's "adjust state when a prop changes"), the keyboard and suggestions below.
  const [draftTabId, setDraftTabId] = useState(activeTabId);
  if (draftTabId !== activeTabId) {
    setDraftTabId(activeTabId);
    setDraft('');
    setValidationMessage(null);
    setIsFocused(false);
  }

  useEffect(() => {
    clearSuggestions();
    Keyboard.dismiss();
    inputRef.current?.blur();
  }, [activeTabId, clearSuggestions]);

  const displayValue = isFocused
    ? draft
    : isHome
      ? ''
      : formatDisplayUrl(currentUrl);

  const dismissEditing = useCallback(() => {
    setIsFocused(false);
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

      if (options?.recordSearchQuery?.trim()) {
        void recordRecentSearch(options.recordSearchQuery.trim());
      }
      return true;
    },
    [clearSuggestions, dismissEditing, recordRecentSearch],
  );

  const onChangeText = useCallback((text: string) => {
    setDraft(text);
    setValidationMessage(null);
  }, []);

  const onFocus = useCallback(() => {
    const seed = isBrowserHomeUrl(currentUrl) ? '' : currentUrl;
    setDraft(seed);
    setValidationMessage(null);
    setIsFocused(true);
    submitLockRef.current = false;
  }, [currentUrl]);

  const onBlur = useCallback(() => {
    // Keep focus state until explicit dismiss / submit so the overlay can receive taps.
  }, []);

  const clear = useCallback(() => {
    setDraft('');
    setValidationMessage(null);
    inputRef.current?.focus();
  }, []);

  const submit = useCallback(() => {
    if (submitLockRef.current) {
      return;
    }

    const result = navigationService.resolveSubmission(draft);

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
      recordSearchQuery: shouldRecordSearch ? draft : undefined,
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
  }, [draft, navigateTo]);

  const selectSuggestion = useCallback(
    (item: OmniboxSuggestion) => {
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
    onChangeText,
    onFocus,
    onBlur,
    clear,
    submit,
    selectSuggestion,
    dismissSuggestions,
  };
}
