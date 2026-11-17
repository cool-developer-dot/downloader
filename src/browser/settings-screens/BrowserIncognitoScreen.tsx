import { memo, useCallback, useMemo, useState } from 'react';

import { openIncognitoTab } from '@/browser/incognito/incognito.service';
import {
  INCOGNITO_SEARCH_ENGINES,
  normalizeIncognitoSearchEngine,
  searchEngineFor,
  type IncognitoSearchEngine,
} from '@/browser/incognito/incognito-settings';
import { normalizeSearchEngineId, SEARCH_ENGINES } from '@/browser/search/search-engines';
import { DsCard, DsHeader, DsIcon, DsRow, DsRowGroup, DsScreen, DsText } from '@/design';
import { useTranslation } from '@/localization';
import { navigation, routePaths } from '@/navigation';
import { ChoiceSheet, type ChoiceOption } from '@/screens/settings/browser-settings/ChoiceSheet';
import { useAppLockStore } from '@/security/app-lock/app-lock.store';
import { useSettingsStore } from '@/store/settings';

import { notify, notifyNotAvailableYet } from './not-available';

/**
 * Design 6 "Incognito": the private-session card and the incognito rows, over B11 (incognito tabs, FLAG_SECURE,
 * wipe on close, the incognito search engine) and App Lock (the incognito lock).
 */
export const BrowserIncognitoScreen = memo(function BrowserIncognitoScreen() {
  const { t } = useTranslation();
  const update = useSettingsStore((s) => s.updateSetting);
  const normalEngine = normalizeSearchEngineId(useSettingsStore((s) => s.searchEngine));
  const incognitoEngine = normalizeIncognitoSearchEngine(useSettingsStore((s) => s.incognitoSearchEngine));
  const appLockOn = useAppLockStore((s) => s.isEnabled);
  const [picker, setPicker] = useState(false);
  const back = useCallback(() => navigation.back(), []);

  const newTab = useCallback(async () => {
    const outcome = await openIncognitoTab();
    if (outcome === 'opened') navigation.navigate(routePaths.browser);
  }, []);

  const engineName = SEARCH_ENGINES[searchEngineFor(normalEngine, incognitoEngine, true)].name;
  const options = useMemo(
    (): ChoiceOption<IncognitoSearchEngine>[] =>
      INCOGNITO_SEARCH_ENGINES.map((value) => ({
        value,
        label: value === 'same' ? t('browserIncognito.searchEngineSame') : SEARCH_ENGINES[value].name,
      })),
    [t],
  );
  const alwaysOn = () => notify(t('lightIncognito.alwaysOn'));

  return (
    <DsScreen testID="browser-incognito-screen">
      <DsHeader
        title={t('lightIncognito.title')}
        subtitle={t('lightIncognito.subtitle')}
        action={{
          icon: 'ellipsis-vertical',
          accessibilityLabel: t('browserIncognito.newTabA11y'),
          onPress: () => void newTab(),
          testID: 'browser-incognito-new-tab',
        }}
      />

      <DsCard style={{ alignItems: 'center', paddingVertical: 26, gap: 6 }} testID="browser-incognito-card">
        <DsIcon name="eye" size={28} color="textPrimary" strokeWidth={2.4} />
        <DsText variant="cardTitle" align="center" style={{ marginTop: 6 }}>
          {t('lightIncognito.privateSession')}
        </DsText>
        <DsText variant="body" align="center">
          {t('lightIncognito.privateSessionBody')}
        </DsText>
      </DsCard>

      <DsRowGroup testID="browser-incognito-rows">
        <DsRow
          icon="lock"
          title={t('lightIncognito.lock')}
          subtitle={t('lightIncognito.lockHint')}
          toggle={{
            value: appLockOn,
            onValueChange: (next) => navigation.push(next ? routePaths.appLockSetup : routePaths.appLockDisable),
            accessibilityLabel: `${t('lightIncognito.lock')}. ${t('lightIncognito.lockOnA11y')}`,
          }}
          testID="browser-incognito-lock"
        />
        <DsRow
          icon="ban"
          title={t('lightIncognito.screenshots')}
          toggle={{ value: true, onValueChange: alwaysOn }}
          testID="browser-incognito-screenshots"
        />
        <DsRow icon="trash-2" title={t('lightIncognito.wipe')} toggle={{ value: true, onValueChange: alwaysOn }} testID="browser-incognito-wipe" />
        <DsRow
          icon="search"
          title={t('browserIncognito.searchEngine')}
          subtitle={engineName}
          onPress={() => setPicker(true)}
          accessibilityHint={t('browserSettings.chooseA11y', { setting: t('browserIncognito.searchEngine'), value: engineName })}
          testID="browser-incognito-search"
        />
        <DsRow
          icon="layers"
          title={t('lightIncognito.extensions')}
          toggle={{ value: false, onValueChange: notifyNotAvailableYet }}
          testID="browser-incognito-extensions"
        />
      </DsRowGroup>

      <ChoiceSheet
        visible={picker}
        title={t('browserIncognito.searchEngine')}
        options={options}
        value={incognitoEngine}
        onSelect={(next) => update('incognitoSearchEngine', next)}
        onClose={() => setPicker(false)}
        testID="browser-incognito-search-sheet"
      />
    </DsScreen>
  );
});
