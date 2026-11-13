import { memo, useMemo, useState } from 'react';
import { AccessibilityInfo, Platform, ToastAndroid } from 'react-native';

import { Switch } from '@/components/inputs/Switch';
import { HomepageSheet } from '@/browser/startup/components/HomepageSheet';
import { KeyboardShortcutsSheet } from '@/browser/startup/components/KeyboardShortcutsSheet';
import {
  BACKGROUND_KIND_LABELS,
  StartPageBackgroundSheet,
} from '@/browser/startup/components/StartPageBackgroundSheet';
import { ToolbarCustomizeSheet } from '@/browser/startup/components/ToolbarCustomizeSheet';
import { normalizeStartPageBackground } from '@/browser/startup/start-page-background';
import {
  normalizeStartupOption,
  readHomepage,
  STARTUP_OPTIONS,
  type StartupOption,
} from '@/browser/startup/startup-settings';
import {
  addToolbarButton,
  MAX_TOOLBAR_BUTTONS,
  parseToolbarButtons,
  removeToolbarButton,
  serializeToolbarButtons,
} from '@/browser/startup/toolbar-buttons';
import { useTranslation, type TranslationKey } from '@/localization';
import { useSettingsStore } from '@/store/settings';

import { SettingsRow, SettingsSection } from '../components';
import { ChoiceSheet, type ChoiceOption } from './ChoiceSheet';

const STARTUP_LABELS: Record<StartupOption, TranslationKey> = {
  continue: 'browserStartup.startupContinue',
  startPage: 'browserStartup.startupStartPage',
  homepage: 'browserStartup.startupHomepage',
};

function notify(message: string): void {
  if (Platform.OS === 'android') ToastAndroid.show(message, ToastAndroid.SHORT);
  AccessibilityInfo.announceForAccessibility(message);
}

/**
 * B21 — Browser settings → Startup and customization: homepage (#232), Home button, what opens at start (#233), spell
 * check (#237), customize toolbar (#238), start page background (#245) and the keyboard shortcuts list (#246).
 */
export const StartupSettingsSection = memo(function StartupSettingsSection() {
  const { t } = useTranslation();
  const update = useSettingsStore((s) => s.updateSetting);
  const homepage = readHomepage(useSettingsStore((s) => s.homepageUrl));
  const startup = normalizeStartupOption(useSettingsStore((s) => s.startupOption));
  const spellCheck = useSettingsStore((s) => s.spellCheck !== false);
  const toolbarValue = useSettingsStore((s) => s.toolbarButtons);
  const toolbar = useMemo(() => parseToolbarButtons(toolbarValue), [toolbarValue]);
  const background = normalizeStartPageBackground(useSettingsStore((s) => s.startPageBackground));
  const [sheet, setSheet] = useState<'homepage' | 'startup' | 'toolbar' | 'background' | 'shortcuts' | null>(null);
  const close = () => setSheet(null);

  const startupOptions = useMemo(
    (): ChoiceOption<StartupOption>[] =>
      STARTUP_OPTIONS.map((value) => ({
        value,
        label: t(STARTUP_LABELS[value]),
        description:
          value === 'startPage'
            ? t('browserStartup.startupStartPageHint')
            : value === 'homepage'
              ? t('browserStartup.startupHomepageHint')
              : undefined,
      })),
    [t],
  );

  const homepageLabel = homepage || t('browserStartup.homepageStartPage');
  const startupLabel = t(STARTUP_LABELS[startup]);
  const backgroundLabel = t(BACKGROUND_KIND_LABELS[background]);
  const homeShown = toolbar.includes('home');

  const setHomeButton = (show: boolean) => {
    if (show && toolbar.length >= MAX_TOOLBAR_BUTTONS) {
      notify(t('browserStartup.toolbarFull', { count: MAX_TOOLBAR_BUTTONS }));
      return;
    }
    if (!show && toolbar.length <= 1) {
      notify(t('browserStartup.toolbarLastButton'));
      return;
    }
    update('toolbarButtons', serializeToolbarButtons(show ? addToolbarButton(toolbar, 'home') : removeToolbarButton(toolbar, 'home')));
  };

  return (
    <SettingsSection
      testID="browser-settings-startup"
      title={t('browserStartup.section')}
      description={t('browserStartup.sectionDescription')}
      icon="tune-variant">
      <SettingsRow
        title={t('browserStartup.homepage')}
        description={t('browserStartup.homepageHint')}
        icon="home-outline"
        value={homepageLabel}
        onPress={() => setSheet('homepage')}
        accessibilityHint={t('browserSettings.chooseA11y', { setting: t('browserStartup.homepage'), value: homepageLabel })}
        testID="browser-settings-homepage"
      />
      <SettingsRow
        title={t('browserStartup.homeButton')}
        description={t('browserStartup.homeButtonHint')}
        icon="home"
        trailing={
          <Switch
            value={homeShown}
            onValueChange={setHomeButton}
            accessibilityLabel={t('browserStartup.homeButton')}
            accessibilityHint={t('browserStartup.homeButtonHint')}
            testID="browser-settings-home-button"
          />
        }
      />
      <SettingsRow
        title={t('browserStartup.startup')}
        description={t('browserStartup.startupLinkNote')}
        icon="power"
        value={startupLabel}
        onPress={() => setSheet('startup')}
        accessibilityHint={t('browserSettings.chooseA11y', { setting: t('browserStartup.startup'), value: startupLabel })}
        testID="browser-settings-startup-option"
      />
      <SettingsRow
        title={t('browserStartup.spellCheck')}
        description={t('browserStartup.spellCheckHint')}
        icon="spellcheck"
        trailing={
          <Switch
            value={spellCheck}
            onValueChange={(next) => update('spellCheck', next)}
            accessibilityLabel={t('browserStartup.spellCheck')}
            accessibilityHint={t('browserStartup.spellCheckHint')}
            testID="browser-settings-spell-check"
          />
        }
      />
      <SettingsRow
        title={t('browserStartup.toolbar')}
        description={t('browserStartup.toolbarHint')}
        icon="dock-bottom"
        onPress={() => setSheet('toolbar')}
        testID="browser-settings-toolbar"
      />
      <SettingsRow
        title={t('browserStartup.background')}
        description={t('browserStartup.backgroundHint')}
        icon="image-outline"
        value={backgroundLabel}
        onPress={() => setSheet('background')}
        accessibilityHint={t('browserSettings.chooseA11y', { setting: t('browserStartup.background'), value: backgroundLabel })}
        testID="browser-settings-background"
      />
      <SettingsRow
        title={t('browserStartup.shortcuts')}
        description={t('browserStartup.shortcutsHint')}
        icon="keyboard-outline"
        onPress={() => setSheet('shortcuts')}
        showDivider={false}
        testID="browser-settings-shortcuts"
      />
      <HomepageSheet
        visible={sheet === 'homepage'}
        value={homepage}
        onSave={(next) => update('homepageUrl', next)}
        onClose={close}
      />
      <ChoiceSheet
        visible={sheet === 'startup'}
        title={t('browserStartup.startup')}
        options={startupOptions}
        value={startup}
        onSelect={(next) => update('startupOption', next)}
        onClose={close}
        testID="browser-settings-startup-sheet"
      />
      <ToolbarCustomizeSheet visible={sheet === 'toolbar'} onClose={close} />
      <StartPageBackgroundSheet visible={sheet === 'background'} onClose={close} />
      <KeyboardShortcutsSheet visible={sheet === 'shortcuts'} onClose={close} />
    </SettingsSection>
  );
});
