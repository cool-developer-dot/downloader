import * as Clipboard from 'expo-clipboard';
import { memo, useCallback, useMemo, useRef, useState } from 'react';
import { AccessibilityInfo, Platform, ToastAndroid, type TextInput } from 'react-native';

import { useOmniboxSuggestions } from '@/browser/hooks/useOmniboxSuggestions';
import { isIncognitoInFront } from '@/browser/incognito/incognito-state';
import {
  normalizeSafeSearch,
  normalizeSearchLanguage,
  normalizeSearchRegion,
  SEARCH_LANGUAGES,
  SEARCH_REGIONS,
  type SearchLanguage,
  type SearchRegion,
} from '@/browser/search/search-engines';
import { parseSearchShortcuts } from '@/browser/search/search-shortcuts';
import { loadUrlActiveTab, navigationService } from '@/browser/services';
import { isYouTubeLink, openPastedLink } from '@/browser/services/pasted-link.service';
import { announceYouTubeNotSupported } from '@/browser/services/youtube-refusal';
import { selectCurrentUrl, useBrowserStore } from '@/browser/stores';
import type { OmniboxSuggestion } from '@/browser/suggestions';
import { extractPageHostname, isValidBrowserPageUrl } from '@/browser/utils';
import {
  DsChip,
  DsChipRow,
  DsHeader,
  DsRow,
  DsRowGroup,
  DsScreen,
  DsSearchField,
  DsSectionLabel,
  type DsIconName,
} from '@/design';
import { useTranslation, type TranslationKey } from '@/localization';
import { navigation, routePaths } from '@/navigation';
import { ChoiceSheet, type ChoiceOption } from '@/screens/settings/browser-settings/ChoiceSheet';
import { useRecentSearchesStore } from '@/store/recent-searches';
import { useSettingsStore } from '@/store/settings';

type Picker = 'language' | 'region' | null;

function notify(message: string): void {
  if (Platform.OS === 'android') ToastAndroid.show(message, ToastAndroid.SHORT);
  AccessibilityInfo.announceForAccessibility(message);
}

/** The design's two row looks: a search glass for searches, a globe + "URL autocomplete" for addresses. */
function rowLook(item: OmniboxSuggestion, t: (key: TranslationKey) => string): { icon: DsIconName; subtitle?: string } {
  switch (item.kind) {
    case 'search':
    case 'recent_search':
      return { icon: 'search' };
    case 'calculator':
      return { icon: 'cpu', subtitle: item.subtitle };
    default:
      return { icon: 'globe', subtitle: t('lightSearch.urlAutocomplete') };
  }
}

/**
 * Design 34 "Search": the typed text with live suggestions (SuggestionService), the user's search shortcuts as
 * chips, Site search, Search language, Region, Safe search and Suggestions. Submitting goes through the browser's
 * own navigation path (the same as the address bar's Enter), then the screen closes so the page shows under the
 * Browser tab.
 */
export const BrowserSearchScreen = memo(function BrowserSearchScreen() {
  const { t } = useTranslation();
  const inputRef = useRef<TextInput>(null);
  const [query, setQuery] = useState('');
  const [picker, setPicker] = useState<Picker>(null);
  const submitLockRef = useRef(false);

  const update = useSettingsStore((state) => state.updateSetting);
  const safe = normalizeSafeSearch(useSettingsStore((state) => state.safeSearch));
  const language = normalizeSearchLanguage(useSettingsStore((state) => state.searchLanguage));
  const region = normalizeSearchRegion(useSettingsStore((state) => state.searchRegion));
  const suggestionsOn = useSettingsStore((state) => state.searchSuggestions !== false);
  const shortcuts = parseSearchShortcuts(useSettingsStore((state) => state.searchShortcuts));
  const recordRecentSearch = useRecentSearchesStore((state) => state.record);
  const currentUrl = useBrowserStore(selectCurrentUrl);

  const { suggestions } = useOmniboxSuggestions({ enabled: true, query });

  const notYet = useCallback(() => {
    ToastAndroid.show(t('common.notAvailableYet'), ToastAndroid.SHORT);
  }, [t]);
  const openSettings = useCallback(() => navigation.push(routePaths.browserSettings), []);
  const clear = useCallback(() => {
    setQuery('');
    inputRef.current?.focus();
  }, []);

  /** Loads `url` the way the address bar does, remembers a search, and closes this screen. */
  const open = useCallback(
    (url: string, options: { typedLink?: boolean; recordSearchQuery?: string }) => {
      if (submitLockRef.current) return;
      if (options.typedLink && isYouTubeLink(url)) {
        notify(announceYouTubeNotSupported());
        return;
      }
      const loaded = options.typedLink ? openPastedLink(url, { source: 'omnibox' }) : loadUrlActiveTab(url);
      if (!loaded) {
        notify(t('browser.addressInvalid'));
        return;
      }
      submitLockRef.current = true;
      // B11: a search typed in an incognito tab is never kept.
      const search = options.recordSearchQuery?.trim();
      if (search && !isIncognitoInFront()) {
        void recordRecentSearch(search);
      }
      navigation.back();
    },
    [recordRecentSearch, t],
  );

  const submit = useCallback(() => {
    const result = navigationService.resolveSubmission(query);
    if (!result.ok) {
      const key: TranslationKey =
        result.intent.kind === 'empty'
          ? 'browser.addressEmpty'
          : result.intent.kind === 'blocked'
            ? 'browser.addressBlocked'
            : 'browser.addressInvalid';
      notify(t(key));
      return;
    }
    open(result.url, {
      typedLink: result.intent.kind === 'navigate',
      recordSearchQuery: result.intent.kind === 'search' ? query : undefined,
    });
  }, [open, query, t]);

  const selectSuggestion = useCallback(
    (item: OmniboxSuggestion) => {
      // B4 #268: the calculator row copies its result; it never navigates.
      if (item.kind === 'calculator') {
        const result = item.title.replace(/^=\s*/, '');
        void Clipboard.setStringAsync(result);
        notify(t('browserAddress.copiedResult', { result }));
        return;
      }
      const isSearch = item.kind === 'search' || item.kind === 'recent_search';
      open(item.url, {
        typedLink: item.kind === 'exact_url',
        recordSearchQuery: isSearch ? (item.kind === 'recent_search' ? item.title : query) : undefined,
      });
    },
    [open, query, t],
  );

  const insertShortcut = useCallback((keyword: string) => {
    setQuery(`${keyword} `);
    inputRef.current?.focus();
  }, []);

  const siteSearch = useCallback(() => {
    const host = isValidBrowserPageUrl(currentUrl) ? extractPageHostname(currentUrl) : '';
    setQuery(host ? `site:${host} ` : 'site:');
    inputRef.current?.focus();
  }, [currentUrl]);

  const languageOptions = useMemo(
    (): ChoiceOption<SearchLanguage>[] =>
      SEARCH_LANGUAGES.map((code) => ({ value: code, label: t(`browserSettings.search.languages.${code}` as TranslationKey) })),
    [t],
  );
  const regionOptions = useMemo(
    (): ChoiceOption<SearchRegion>[] =>
      SEARCH_REGIONS.map((code) => ({ value: code, label: t(`browserSettings.search.regions.${code}` as TranslationKey) })),
    [t],
  );
  const languageLabel = t(`browserSettings.search.languages.${language}` as TranslationKey);
  const regionLabel = t(`browserSettings.search.regions.${region}` as TranslationKey);
  const activeKeyword = query.includes(' ') ? query.slice(0, query.indexOf(' ')).toLowerCase() : '';

  return (
    <DsScreen testID="browser-search-screen">
      <DsHeader
        title={t('lightSearch.title')}
        action={{ icon: 'settings', accessibilityLabel: t('lightSearch.settingsA11y'), onPress: openSettings, testID: 'browser-search-settings' }}
      />
      <DsSearchField
        ref={inputRef}
        testID="browser-search-field"
        value={query}
        onChangeText={setQuery}
        onSubmitEditing={submit}
        autoFocus
        autoCapitalize="none"
        autoCorrect={false}
        autoComplete="off"
        keyboardType="web-search"
        returnKeyType="go"
        blurOnSubmit={false}
        accessibilityLabel={t('lightSearch.fieldA11y')}
        actions={[
          { icon: 'mic', accessibilityLabel: t('lightSearch.micA11y'), onPress: notYet, testID: 'browser-search-mic' },
          { icon: 'x', accessibilityLabel: t('lightSearch.clearA11y'), onPress: clear, testID: 'browser-search-clear' },
        ]}
      />

      {suggestions.length > 0 ? (
        <>
          <DsSectionLabel>{t('lightSearch.suggestions')}</DsSectionLabel>
          <DsRowGroup testID="browser-search-suggestions">
            {suggestions.map((item) => {
              const look = rowLook(item, t);
              return (
                <DsRow
                  key={item.id}
                  icon={look.icon}
                  title={item.title}
                  subtitle={look.subtitle}
                  onPress={() => selectSuggestion(item)}
                  accessibilityLabel={t('lightSearch.openSuggestionA11y', { title: item.title })}
                  testID={`browser-search-suggestion-${item.id}`}
                />
              );
            })}
          </DsRowGroup>
        </>
      ) : null}

      {shortcuts.length > 0 ? (
        <>
          <DsSectionLabel>{t('lightSearch.shortcuts')}</DsSectionLabel>
          <DsChipRow testID="browser-search-shortcuts">
            {shortcuts.map((shortcut) => (
              <DsChip
                key={shortcut.keyword}
                label={`@${shortcut.keyword}`}
                selected={activeKeyword === shortcut.keyword.toLowerCase()}
                accessibilityLabel={t('lightSearch.shortcutA11y', { name: shortcut.name })}
                onPress={() => insertShortcut(shortcut.keyword)}
                testID={`browser-search-shortcut-${shortcut.keyword}`}
              />
            ))}
          </DsChipRow>
        </>
      ) : null}

      <DsRowGroup testID="browser-search-options">
        <DsRow icon="search" title={t('lightSearch.siteSearch')} subtitle={t('lightSearch.siteSearchHint')} onPress={siteSearch} testID="browser-search-site" />
        <DsRow icon="languages" title={t('lightSearch.searchLanguage')} subtitle={languageLabel} onPress={() => setPicker('language')} testID="browser-search-language" />
        <DsRow icon="globe" title={t('lightSearch.region')} subtitle={regionLabel} onPress={() => setPicker('region')} testID="browser-search-region" />
        <DsRow
          icon="shield"
          title={t('lightSearch.safeSearch')}
          toggle={{ value: safe === 'strict', onValueChange: (next) => update('safeSearch', next ? 'strict' : 'moderate') }}
          testID="browser-search-safe"
        />
        <DsRow
          icon="sparkles"
          title={t('lightSearch.suggestionsToggle')}
          toggle={{ value: suggestionsOn, onValueChange: (next) => update('searchSuggestions', next) }}
          testID="browser-search-suggestions-toggle"
        />
      </DsRowGroup>

      <ChoiceSheet
        visible={picker === 'language'}
        title={t('lightSearch.searchLanguage')}
        options={languageOptions}
        value={language}
        onSelect={(next) => update('searchLanguage', next)}
        onClose={() => setPicker(null)}
        testID="browser-search-language-sheet"
      />
      <ChoiceSheet
        visible={picker === 'region'}
        title={t('lightSearch.region')}
        options={regionOptions}
        value={region}
        onSelect={(next) => update('searchRegion', next)}
        onClose={() => setPicker(null)}
        testID="browser-search-region-sheet"
      />
    </DsScreen>
  );
});
