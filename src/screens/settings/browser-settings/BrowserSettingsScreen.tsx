import { memo, useCallback, useMemo, useState } from 'react';

import { ActionSheetModal } from '@/components/bottom-sheets/ActionSheetModal';
import type { ActionSheetItem } from '@/components/bottom-sheets/ActionSheet';
import { ConfirmModal } from '@/components/modals/ConfirmModal';
import { normalizeAddressBarPosition, ADDRESS_BAR_POSITIONS, type AddressBarPosition } from '@/browser/address-bar/address-bar-settings';
import { EngineBadge } from '@/browser/components/EngineBadge';
import { normalizeSearchEngineId, SEARCH_ENGINE_IDS, SEARCH_ENGINES, type SearchEngineId } from '@/browser/search/search-engines';
import { BROWSER_SETTING_KEYS } from '@/browser/settings/browser-setting-keys';
import { BlockImagesSheet } from '@/browser/settings-screens/BlockImagesSheet';
import { notify } from '@/browser/settings-screens/not-available';
import { SectionSheet } from '@/browser/settings-screens/SectionSheet';
import { SitePermissionsSheet } from '@/browser/site-permissions/components/SitePermissionsSheet';
import { KeyboardShortcutsSheet } from '@/browser/startup/components/KeyboardShortcutsSheet';
import { StartPageBackgroundSheet } from '@/browser/startup/components/StartPageBackgroundSheet';
import { ToolbarCustomizeSheet } from '@/browser/startup/components/ToolbarCustomizeSheet';
import { readHomepage } from '@/browser/startup/startup-settings';
import { getEnabledLanguages } from '@/constants/languages';
import { DsHeader, DsRow, DsRowGroup, DsScreen, DsSectionLabel } from '@/design';
import { languageNameKey, resolveLanguage, useTranslation } from '@/localization';
import { navigation, routePaths, type NavigationTarget } from '@/navigation';
import { applySettings } from '@/screens/settings/backup-reset/apply-settings';
import { updateLanguagePreference } from '@/services/auth/settings.service';
import { useSettingsStore, type SettingsKey } from '@/store/settings';
import { settingsResetEntries } from '@/store/settings/reset';
import { initialSettingsState } from '@/store/settings/state';

import { AddressBarSettingsSection } from './AddressBarSettingsSection';
import { AnnotateSettingsSection } from './AnnotateSettingsSection';
import { BookmarksSettingsSection } from './BookmarksSettingsSection';
import { BrowserDataSection } from './BrowserDataSection';
import { CaptureSettingsSection } from './CaptureSettingsSection';
import { ChoiceSheet, type ChoiceOption } from './ChoiceSheet';
import { DataSaverSettingsSection } from './DataSaverSettingsSection';
import { HistorySettingsSection } from './HistorySettingsSection';
import { NavigationSettingsSection } from './NavigationSettingsSection';
import { PageDisplaySettingsSection } from './PageDisplaySettingsSection';
import { ProfilesSettingsSection } from './ProfilesSettingsSection';
import { SearchSettingsSection } from './SearchSettingsSection';
import { ShareSettingsSection } from './ShareSettingsSection';
import { StartupSettingsSection } from './StartupSettingsSection';
import { TabGroupsSettingsSection } from './TabGroupsSettingsSection';
import { TabsSettingsSection } from './TabsSettingsSection';
import { UrduSettingsSection } from './UrduSettingsSection';

type Sheet =
  | 'engine'
  | 'search'
  | 'startup'
  | 'position'
  | 'language'
  | 'images'
  | 'dataSaver'
  | 'memory'
  | 'permissions'
  | 'profiles'
  | 'background'
  | 'shortcuts'
  | 'toolbar'
  | 'backup'
  | 'reset'
  | 'more'
  | null;

const BROWSER_KEYS = new Set<string>(BROWSER_SETTING_KEYS);

/** Every browser setting back to its default (the app's Reset, limited to `BROWSER_SETTING_KEYS`); the language is kept. */
function resetBrowserSettings(): void {
  const entries = settingsResetEntries(initialSettingsState as unknown as Record<string, unknown>).filter(([key]) =>
    BROWSER_KEYS.has(key),
  ) as [SettingsKey, unknown][];
  applySettings(entries);
}

/**
 * Design 9 "Browser · Settings" — the hub of the browser module (route `/browser/settings`). The frame's GENERAL and
 * PERFORMANCE cards, then BROWSE (the other design screens), PRIVACY and ADVANCED. Each row opens the screen, choice
 * sheet or existing settings section behind it; no setting is implemented twice.
 */
export const BrowserSettingsScreen = memo(function BrowserSettingsScreen() {
  const { t, language } = useTranslation();
  const update = useSettingsStore((s) => s.updateSetting);
  const engineId = normalizeSearchEngineId(useSettingsStore((s) => s.searchEngine));
  const homepage = readHomepage(useSettingsStore((s) => s.homepageUrl));
  const position = normalizeAddressBarPosition(useSettingsStore((s) => s.addressBarPosition));
  const dataSaver = useSettingsStore((s) => s.dataSaver === true);
  const [sheet, setSheet] = useState<Sheet>(null);
  const close = useCallback(() => setSheet(null), []);
  const back = useCallback(() => navigation.back(), []);
  const openAppSettings = useCallback(() => navigation.navigate(routePaths.settings), []);

  const engineOptions = useMemo(
    (): ChoiceOption<SearchEngineId>[] =>
      SEARCH_ENGINE_IDS.map((id) => ({ value: id, label: SEARCH_ENGINES[id].name, leading: <EngineBadge engine={id} /> })),
    [],
  );
  const positionLabel = (value: AddressBarPosition) =>
    value === 'top' ? t('browserAddress.positionTop') : t('browserAddress.positionBottom');
  const positionOptions = useMemo(
    (): ChoiceOption<AddressBarPosition>[] =>
      ADDRESS_BAR_POSITIONS.map((value) => ({
        value,
        label: value === 'top' ? t('browserAddress.positionTop') : t('browserAddress.positionBottom'),
      })),
    [t],
  );
  const languageActions = useMemo<ActionSheetItem[]>(
    () =>
      getEnabledLanguages().map((entry) => ({
        id: entry.code,
        label: `${t(languageNameKey(resolveLanguage(entry.code)))} · ${entry.nativeLabel}`,
        icon: 'translate' as const,
        selected: entry.code === language,
        onPress: () => {
          setSheet(null);
          void updateLanguagePreference(entry.code);
        },
      })),
    [language, t],
  );

  const go = (path: NavigationTarget) => () => navigation.push(path);
  const open = (next: Sheet) => () => setSheet(next);

  return (
    <DsScreen testID="browser-settings-screen">
      <DsHeader
        title={t('browserSettings.title')}
        onBack={back}
        action={{
          icon: 'settings',
          accessibilityLabel: t('lightBrowserSettings.openAppSettingsA11y'),
          onPress: openAppSettings,
          testID: 'browser-settings-app-settings',
        }}
        testID="browser-settings-header"
      />

      <DsSectionLabel first>{t('lightBrowserSettings.general')}</DsSectionLabel>
      <DsRowGroup testID="browser-settings-general">
        <DsRow
          icon="search"
          title={t('browserSettings.search.engine')}
          subtitle={SEARCH_ENGINES[engineId].name}
          onPress={open('engine')}
          accessibilityHint={t('browserSettings.chooseA11y', { setting: t('browserSettings.search.engine'), value: SEARCH_ENGINES[engineId].name })}
          testID="browser-settings-search-engine"
        />
        <DsRow icon="globe" title={t('lightBrowserSettings.siteSearch')} onPress={open('search')} testID="browser-settings-site-search" />
        <DsRow
          icon="folder"
          title={t('lightBrowserSettings.homepage')}
          subtitle={homepage || t('lightBrowserSettings.homepageDefault')}
          onPress={open('startup')}
          testID="browser-settings-homepage"
        />
        <DsRow
          icon="sliders-vertical"
          title={t('lightBrowserSettings.addressBar')}
          subtitle={positionLabel(position)}
          onPress={open('position')}
          accessibilityHint={t('browserSettings.chooseA11y', { setting: t('lightBrowserSettings.addressBar'), value: positionLabel(position) })}
          testID="browser-settings-address-position"
        />
        <DsRow
          icon="languages"
          title={t('lightBrowserSettings.language')}
          subtitle={t(languageNameKey(language))}
          onPress={open('language')}
          testID="browser-settings-language"
        />
      </DsRowGroup>

      <DsSectionLabel>{t('lightBrowserSettings.performance')}</DsSectionLabel>
      <DsRowGroup testID="browser-settings-performance">
        <DsRow
          icon="gauge"
          title={t('lightBrowserSettings.dataSaver')}
          toggle={{ value: dataSaver, onValueChange: (next) => update('dataSaver', next) }}
          testID="browser-settings-data-saver-switch"
        />
        <DsRow icon="image" title={t('lightBrowserSettings.blockImages')} onPress={open('images')} testID="browser-settings-block-images-row" />
        <DsRow icon="battery-medium" title={t('lightBrowserSettings.battery')} onPress={open('dataSaver')} testID="browser-settings-battery" />
        <DsRow icon="cpu" title={t('lightBrowserSettings.memory')} onPress={open('memory')} testID="browser-settings-memory" />
      </DsRowGroup>

      <DsSectionLabel>{t('lightBrowserSettings.browse')}</DsSectionLabel>
      <DsRowGroup testID="browser-settings-browse">
        <DsRow icon="layout-grid" title={t('lightBrowserSettings.tabs')} onPress={go(routePaths.browserTabs)} testID="browser-settings-tabs" />
        <DsRow icon="bookmark" title={t('lightBrowserSettings.bookmarks')} onPress={go(routePaths.bookmarks)} testID="browser-settings-bookmarks" />
        <DsRow icon="history" title={t('lightBrowserSettings.history')} onPress={go(routePaths.history)} testID="browser-settings-history" />
        <DsRow icon="search" title={t('lightBrowserSettings.search')} onPress={go(routePaths.browserSearch)} testID="browser-settings-search" />
        <DsRow icon="box" title={t('lightBrowserSettings.utilities')} onPress={go(routePaths.browserUtilities)} testID="browser-settings-utilities" />
        <DsRow icon="type" title={t('lightBrowserSettings.display')} onPress={go(routePaths.browserDisplay)} testID="browser-settings-display" />
        <DsRow icon="timer" title={t('lightBrowserSettings.focus')} onPress={go(routePaths.browserFocus)} testID="browser-settings-focus" />
      </DsRowGroup>

      <DsSectionLabel>{t('lightBrowserSettings.privacy')}</DsSectionLabel>
      <DsRowGroup testID="browser-settings-privacy">
        <DsRow icon="shield" title={t('lightBrowserSettings.privacySecurity')} onPress={go(routePaths.browserPrivacy)} testID="browser-settings-privacy-row" />
        <DsRow icon="eye-off" title={t('lightBrowserSettings.incognito')} onPress={go(routePaths.browserIncognito)} testID="browser-settings-incognito" />
        <DsRow icon="key" title={t('lightBrowserSettings.passwords')} onPress={go(routePaths.browserPasswords)} testID="browser-settings-passwords" />
        <DsRow icon="circle" title={t('lightBrowserSettings.sitePermissions')} onPress={open('permissions')} testID="browser-settings-site-permissions-open" />
        <DsRow icon="users" title={t('lightBrowserSettings.profiles')} onPress={open('profiles')} testID="browser-settings-profiles-row" />
      </DsRowGroup>

      <DsSectionLabel>{t('lightBrowserSettings.advanced')}</DsSectionLabel>
      <DsRowGroup testID="browser-settings-advanced">
        <DsRow icon="code" title={t('lightBrowserSettings.developer')} onPress={go(routePaths.browserDeveloper)} testID="browser-settings-developer" />
        <DsRow icon="image" title={t('lightBrowserSettings.background')} onPress={open('background')} testID="browser-settings-background" />
        <DsRow icon="keyboard" title={t('lightBrowserSettings.shortcuts')} onPress={open('shortcuts')} testID="browser-settings-shortcuts" />
        <DsRow icon="sliders-horizontal" title={t('lightBrowserSettings.toolbar')} onPress={open('toolbar')} testID="browser-settings-toolbar" />
        <DsRow icon="archive" title={t('lightBrowserSettings.backup')} onPress={open('backup')} testID="browser-settings-backup" />
        <DsRow icon="rotate-cw" title={t('lightBrowserSettings.reset')} onPress={open('reset')} testID="browser-settings-reset" />
        <DsRow
          icon="list"
          title={t('lightBrowserSettings.more')}
          subtitle={t('lightBrowserSettings.moreHint')}
          onPress={open('more')}
          testID="browser-settings-more"
        />
      </DsRowGroup>

      <ChoiceSheet
        visible={sheet === 'engine'}
        title={t('browserSettings.search.engine')}
        options={engineOptions}
        value={engineId}
        onSelect={(next) => update('searchEngine', next)}
        onClose={close}
        testID="browser-settings-engine-sheet"
      />
      <ChoiceSheet
        visible={sheet === 'position'}
        title={t('lightBrowserSettings.addressBar')}
        options={positionOptions}
        value={position}
        onSelect={(next) => update('addressBarPosition', next)}
        onClose={close}
        testID="browser-settings-position-sheet"
      />
      <ActionSheetModal
        visible={sheet === 'language'}
        onClose={close}
        title={t('settings.languageSheetTitle')}
        subtitle={t('settings.languageSheetSubtitle')}
        actions={languageActions}
        cancelLabel={t('common.cancel')}
        testID="browser-settings-language-sheet"
      />
      <SectionSheet visible={sheet === 'search'} title={t('lightBrowserSettings.siteSearch')} onClose={close} testID="browser-settings-search-sheet">
        <SearchSettingsSection />
      </SectionSheet>
      <SectionSheet visible={sheet === 'startup'} title={t('lightBrowserSettings.homepage')} onClose={close} testID="browser-settings-startup-sheet">
        <StartupSettingsSection />
      </SectionSheet>
      <BlockImagesSheet visible={sheet === 'images'} onClose={close} />
      <SectionSheet visible={sheet === 'dataSaver'} title={t('lightBrowserSettings.battery')} onClose={close} testID="browser-settings-data-saver-sheet">
        <DataSaverSettingsSection />
      </SectionSheet>
      <SectionSheet visible={sheet === 'memory'} title={t('lightBrowserSettings.memory')} onClose={close} testID="browser-settings-memory-sheet">
        <TabsSettingsSection />
        <TabGroupsSettingsSection />
      </SectionSheet>
      <SitePermissionsSheet site={sheet === 'permissions' ? '' : null} onClose={close} />
      <SectionSheet visible={sheet === 'profiles'} title={t('lightBrowserSettings.profiles')} onClose={close} testID="browser-settings-profiles-sheet">
        <ProfilesSettingsSection />
      </SectionSheet>
      <StartPageBackgroundSheet visible={sheet === 'background'} onClose={close} />
      <KeyboardShortcutsSheet visible={sheet === 'shortcuts'} onClose={close} />
      <ToolbarCustomizeSheet visible={sheet === 'toolbar'} onClose={close} />
      <SectionSheet visible={sheet === 'backup'} title={t('lightBrowserSettings.backup')} onClose={close} testID="browser-settings-backup-sheet">
        <BrowserDataSection />
      </SectionSheet>
      <SectionSheet visible={sheet === 'more'} title={t('lightBrowserSettings.more')} onClose={close} testID="browser-settings-more-sheet">
        <AddressBarSettingsSection />
        <NavigationSettingsSection />
        <HistorySettingsSection />
        <BookmarksSettingsSection />
        <PageDisplaySettingsSection />
        <UrduSettingsSection />
        <CaptureSettingsSection />
        <AnnotateSettingsSection />
        <ShareSettingsSection />
      </SectionSheet>
      <ConfirmModal
        visible={sheet === 'reset'}
        variant="warning"
        title={t('lightBrowserSettings.resetTitle')}
        message={t('lightBrowserSettings.resetMessage')}
        confirmLabel={t('common.reset')}
        cancelLabel={t('common.cancel')}
        onConfirm={() => {
          setSheet(null);
          resetBrowserSettings();
          notify(t('lightBrowserSettings.resetDone'));
        }}
        onCancel={close}
        testID="browser-settings-reset-confirm"
      />
    </DsScreen>
  );
});
