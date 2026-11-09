import { memo, useMemo, useState } from 'react';

import { SEARCH_ENGINES } from '@/browser/search/search-engines';
import {
  INCOGNITO_SEARCH_ENGINES,
  normalizeIncognitoSearchEngine,
  type IncognitoSearchEngine,
} from '@/browser/incognito/incognito-settings';
import { useTranslation } from '@/localization';
import { useSettingsStore } from '@/store/settings';

import { SettingsRow, SettingsSection } from '../components';
import { ChoiceSheet, type ChoiceOption } from './ChoiceSheet';

/** B11 #111 — Browser settings → Incognito: the search engine for incognito tabs ('same' by default). */
export const IncognitoSettingsSection = memo(function IncognitoSettingsSection() {
  const { t } = useTranslation();
  const update = useSettingsStore((s) => s.updateSetting);
  const engine = normalizeIncognitoSearchEngine(useSettingsStore((s) => s.incognitoSearchEngine));
  const [open, setOpen] = useState(false);
  const label = (value: IncognitoSearchEngine) =>
    value === 'same' ? t('browserIncognito.searchEngineSame') : SEARCH_ENGINES[value].name;
  const options = useMemo(
    (): ChoiceOption<IncognitoSearchEngine>[] =>
      INCOGNITO_SEARCH_ENGINES.map((value) => ({
        value,
        label: value === 'same' ? t('browserIncognito.searchEngineSame') : SEARCH_ENGINES[value].name,
      })),
    [t],
  );

  return (
    <SettingsSection testID="browser-settings-incognito" title={t('browserIncognito.sectionTitle')} icon="incognito">
      <SettingsRow
        title={t('browserIncognito.searchEngine')}
        description={t('browserIncognito.searchEngineHint')}
        icon="magnify"
        value={label(engine)}
        onPress={() => setOpen(true)}
        accessibilityHint={t('browserSettings.chooseA11y', {
          setting: t('browserIncognito.searchEngine'),
          value: label(engine),
        })}
        showDivider={false}
        testID="browser-settings-incognito-search"
      />
      <ChoiceSheet
        visible={open}
        title={t('browserIncognito.searchEngine')}
        options={options}
        value={engine}
        onSelect={(next) => update('incognitoSearchEngine', next)}
        onClose={() => setOpen(false)}
        testID="browser-settings-incognito-search-sheet"
      />
    </SettingsSection>
  );
});
