import { memo, useMemo, useState } from 'react';

import { Switch } from '@/components/inputs/Switch';
import {
  normalizeSafeSearch,
  normalizeSearchEngineId,
  normalizeSearchLanguage,
  normalizeSearchRegion,
  SAFE_SEARCH_LEVELS,
  SEARCH_ENGINE_IDS,
  SEARCH_ENGINES,
  SEARCH_LANGUAGES,
  SEARCH_REGIONS,
  type SafeSearchLevel,
  type SearchEngineId,
  type SearchLanguage,
  type SearchRegion,
} from '@/browser/search/search-engines';
import { Text } from '@/components/base/Text';
import { useTranslation } from '@/localization';
import { useSettingsStore } from '@/store/settings';

import { SettingsRow, SettingsSection } from '../components';
import { ChoiceSheet, type ChoiceOption } from './ChoiceSheet';
import { SearchShortcutsSheet } from './SearchShortcutsSheet';
import { parseSearchShortcuts } from '@/browser/search/search-shortcuts';
import { EngineBadge } from '@/browser/components/EngineBadge';

type Picker = 'engine' | 'safe' | 'language' | 'region' | 'shortcuts' | null;

const SAFE_LABEL_KEYS: Record<SafeSearchLevel, string> = {
  off: 'browserSettings.search.safeOff',
  moderate: 'browserSettings.search.safeModerate',
  strict: 'browserSettings.search.safeStrict',
};

/** B5 — Browser settings → Search: engine (#56), Safe Search (#62), language (#63), region (#64), suggestions (#61). */
export const SearchSettingsSection = memo(function SearchSettingsSection() {
  const { t } = useTranslation();
  const update = useSettingsStore((s) => s.updateSetting);
  const engineId = normalizeSearchEngineId(useSettingsStore((s) => s.searchEngine));
  const safe = normalizeSafeSearch(useSettingsStore((s) => s.safeSearch));
  const language = normalizeSearchLanguage(useSettingsStore((s) => s.searchLanguage));
  const region = normalizeSearchRegion(useSettingsStore((s) => s.searchRegion));
  const suggestions = useSettingsStore((s) => s.searchSuggestions !== false);
  const shortcutCount = parseSearchShortcuts(useSettingsStore((s) => s.searchShortcuts)).length;
  const [picker, setPicker] = useState<Picker>(null);
  const engine = SEARCH_ENGINES[engineId];

  const engineOptions = useMemo(
    (): ChoiceOption<SearchEngineId>[] =>
      SEARCH_ENGINE_IDS.map((id) => ({
        value: id,
        label: SEARCH_ENGINES[id].name,
        leading: <EngineBadge engine={id} />,
      })),
    [],
  );
  const safeOptions = useMemo(
    (): ChoiceOption<SafeSearchLevel>[] =>
      SAFE_SEARCH_LEVELS.map((level) => ({ value: level, label: t(SAFE_LABEL_KEYS[level] as never) })),
    [t],
  );
  const languageOptions = useMemo(
    (): ChoiceOption<SearchLanguage>[] =>
      SEARCH_LANGUAGES.map((code) => ({ value: code, label: t(`browserSettings.search.languages.${code}` as never) })),
    [t],
  );
  const regionOptions = useMemo(
    (): ChoiceOption<SearchRegion>[] =>
      SEARCH_REGIONS.map((code) => ({ value: code, label: t(`browserSettings.search.regions.${code}` as never) })),
    [t],
  );

  const safeLabel = t(SAFE_LABEL_KEYS[safe] as never);
  const languageLabel = t(`browserSettings.search.languages.${language}` as never);
  const regionLabel = t(`browserSettings.search.regions.${region}` as never);

  // What this engine cannot apply from the link (shown under the rows, so a choice never silently does nothing).
  const notes: string[] = [];
  if (engine.support.safeSearch === 'none') {
    notes.push(t('browserSettings.search.notSupported', { engine: engine.name }));
  } else {
    if (engineId === 'google' && safe === 'moderate') notes.push(t('browserSettings.search.safeNearestGoogle'));
    if (engine.support.language === 'nearest' && language !== 'default') {
      notes.push(t('browserSettings.search.nearestLanguage', { engine: engine.name }));
    }
    if (engine.support.region === 'nearest' && region !== 'auto') {
      notes.push(t('browserSettings.search.nearestRegion', { engine: engine.name }));
    }
  }
  const unsupported = engine.support.safeSearch === 'none';

  return (
    <SettingsSection
      testID="browser-settings-search"
      title={t('browserSettings.search.section')}
      description={t('browserSettings.search.sectionDescription')}
      icon="magnify">
      <SettingsRow
        title={t('browserSettings.search.engine')}
        description={t('browserSettings.search.engineHint')}
        icon="web"
        value={engine.name}
        onPress={() => setPicker('engine')}
        accessibilityHint={t('browserSettings.chooseA11y', { setting: t('browserSettings.search.engine'), value: engine.name })}
        testID="browser-settings-search-engine"
      />
      <SettingsRow
        title={t('browserSettings.search.safeSearch')}
        description={t('browserSettings.search.safeSearchHint')}
        icon="shield-check-outline"
        value={unsupported ? '—' : safeLabel}
        onPress={unsupported ? undefined : () => setPicker('safe')}
        accessibilityHint={t('browserSettings.chooseA11y', { setting: t('browserSettings.search.safeSearch'), value: safeLabel })}
        testID="browser-settings-search-safe"
      />
      <SettingsRow
        title={t('browserSettings.search.language')}
        description={t('browserSettings.search.languageHint')}
        icon="translate"
        value={unsupported ? '—' : languageLabel}
        onPress={unsupported ? undefined : () => setPicker('language')}
        accessibilityHint={t('browserSettings.chooseA11y', { setting: t('browserSettings.search.language'), value: languageLabel })}
        testID="browser-settings-search-language"
      />
      <SettingsRow
        title={t('browserSettings.search.region')}
        description={t('browserSettings.search.regionHint')}
        icon="map-marker-outline"
        value={unsupported ? '—' : regionLabel}
        onPress={unsupported ? undefined : () => setPicker('region')}
        accessibilityHint={t('browserSettings.chooseA11y', { setting: t('browserSettings.search.region'), value: regionLabel })}
        testID="browser-settings-search-region"
      />
      {notes.length > 0 ? (
        <Text variant="caption" color="textSecondary" accessibilityLiveRegion="polite" style={{ paddingVertical: 8 }}>
          {notes.join(' ')}
        </Text>
      ) : null}
      <SettingsRow
        title={t('browserAddress.shortcuts')}
        description={t('browserAddress.shortcutsHint')}
        icon="keyboard-outline"
        value={t('browserAddress.shortcutsCount', { count: shortcutCount })}
        onPress={() => setPicker('shortcuts')}
        testID="browser-settings-search-shortcuts"
      />
      <SettingsRow
        title={t('browserSettings.search.suggestions')}
        description={t('browserSettings.search.suggestionsHint')}
        icon="lightbulb-outline"
        showDivider={false}
        trailing={
          <Switch
            value={suggestions}
            onValueChange={(next) => update('searchSuggestions', next)}
            accessibilityLabel={t('browserSettings.search.suggestions')}
            accessibilityHint={t('browserSettings.search.suggestionsHint')}
            testID="browser-settings-search-suggestions"
          />
        }
      />

      <SearchShortcutsSheet visible={picker === 'shortcuts'} onClose={() => setPicker(null)} />
      <ChoiceSheet
        visible={picker === 'engine'}
        title={t('browserSettings.search.engine')}
        options={engineOptions}
        value={engineId}
        onSelect={(next) => update('searchEngine', next)}
        onClose={() => setPicker(null)}
        testID="browser-settings-engine-sheet"
      />
      <ChoiceSheet
        visible={picker === 'safe'}
        title={t('browserSettings.search.safeSearch')}
        options={safeOptions}
        value={safe}
        onSelect={(next) => update('safeSearch', next)}
        onClose={() => setPicker(null)}
        testID="browser-settings-safe-sheet"
      />
      <ChoiceSheet
        visible={picker === 'language'}
        title={t('browserSettings.search.language')}
        options={languageOptions}
        value={language}
        onSelect={(next) => update('searchLanguage', next)}
        onClose={() => setPicker(null)}
        testID="browser-settings-language-sheet"
      />
      <ChoiceSheet
        visible={picker === 'region'}
        title={t('browserSettings.search.region')}
        options={regionOptions}
        value={region}
        onSelect={(next) => update('searchRegion', next)}
        onClose={() => setPicker(null)}
        testID="browser-settings-region-sheet"
      />
    </SettingsSection>
  );
});
