import { memo, useCallback, useState } from 'react';

import { ConfirmModal } from '@/components/modals/ConfirmModal';
import {
  isRemoteDebugging,
  openDevtoolsPanel,
  setRemoteDebugging,
  useDevtoolsVersion,
} from '@/browser/devtools/devtools.service';
import { useBrowserStore } from '@/browser/stores';
import { DsHeader, DsRow, DsRowGroup, DsScreen } from '@/design';
import { useTranslation } from '@/localization';
import { navigation, routePaths } from '@/navigation';
import { UserScriptsSheet } from '@/screens/settings/browser-settings/DeveloperSettingsSection';
import { useSettingsStore } from '@/store/settings';

import { notify, notifyNotAvailableYet } from './not-available';

type PanelSection = 'console' | 'network' | 'inspect' | 'source' | 'storage' | 'security' | 'scripts' | 'device';

/**
 * Design 8 "Developer tools": each row opens B19's panel on the page in front at that tool. Off = nothing is injected
 * into pages, so opening a tool turns Developer tools on first (the user's consent); the User scripts switch is that
 * master switch.
 */
export const BrowserDeveloperScreen = memo(function BrowserDeveloperScreen() {
  'use no memo';
  const { t } = useTranslation();
  useDevtoolsVersion();
  const update = useSettingsStore((s) => s.updateSetting);
  const devTools = useSettingsStore((s) => s.devTools === true);
  const remote = isRemoteDebugging();
  const [warn, setWarn] = useState(false);
  const [scripts, setScripts] = useState(false);
  const back = useCallback(() => navigation.back(), []);
  const openSettings = useCallback(() => navigation.push(routePaths.browserSettings), []);

  const openTool = (section: PanelSection) => {
    const tabId = useBrowserStore.getState().activeTabId;
    if (!tabId) {
      notify(t('lightDeveloper.noTab'));
      return;
    }
    if (!devTools) update('devTools', true);
    openDevtoolsPanel(tabId, section);
    navigation.navigate(routePaths.browser);
  };

  const openScripts = () => {
    if (!devTools) update('devTools', true);
    setScripts(true);
  };

  const remoteValue = remote ? t('common.on') : t('common.off');

  return (
    <DsScreen testID="browser-developer-screen">
      <DsHeader
        title={t('lightDeveloper.title')}
        subtitle={t('lightDeveloper.subtitle')}
        onBack={back}
        action={{
          icon: 'settings',
          accessibilityLabel: t('lightPrivacy.openSettingsA11y'),
          onPress: openSettings,
          testID: 'browser-developer-settings',
        }}
      />
      <DsRowGroup testID="browser-developer-rows">
        <DsRow icon="flask-conical" title={t('lightDeveloper.inspect')} onPress={() => openTool('inspect')} testID="browser-developer-inspect" />
        <DsRow icon="terminal" title={t('lightDeveloper.console')} onPress={() => openTool('console')} testID="browser-developer-console" />
        <DsRow icon="cast" title={t('lightDeveloper.network')} onPress={() => openTool('network')} testID="browser-developer-network" />
        <DsRow icon="file-text" title={t('lightDeveloper.source')} onPress={() => openTool('source')} testID="browser-developer-source" />
        <DsRow icon="smartphone" title={t('lightDeveloper.device')} onPress={() => openTool('device')} testID="browser-developer-device" />
        <DsRow
          icon="battery-medium"
          title={t('lightDeveloper.remote')}
          value={remoteValue}
          trailing="chevron"
          onPress={() => (remote ? void setRemoteDebugging(false) : setWarn(true))}
          accessibilityLabel={`${t('lightDeveloper.remote')}, ${remoteValue}`}
          accessibilityHint={t('browserDevtools.remoteHint')}
          testID="browser-developer-remote"
        />
        <DsRow icon="gauge" title={t('lightDeveloper.profiler')} onPress={notifyNotAvailableYet} testID="browser-developer-profiler" />
        <DsRow icon="database" title={t('lightDeveloper.storage')} onPress={() => openTool('storage')} testID="browser-developer-storage" />
        <DsRow
          icon="layers"
          title={t('lightDeveloper.userScripts')}
          toggle={{ value: devTools, onValueChange: (next) => update('devTools', next), accessibilityLabel: t('browserDevtools.enable') }}
          onPress={openScripts}
          accessibilityHint={t('lightDeveloper.userScriptsA11y')}
          testID="browser-developer-scripts"
        />
      </DsRowGroup>

      <ConfirmModal
        visible={warn}
        variant="warning"
        title={t('browserDevtools.remoteWarnTitle')}
        message={t('browserDevtools.remoteWarnMessage')}
        confirmLabel={t('browserDevtools.remoteTurnOn')}
        cancelLabel={t('common.cancel')}
        onConfirm={() => {
          setWarn(false);
          if (!devTools) update('devTools', true);
          void setRemoteDebugging(true);
        }}
        onCancel={() => setWarn(false)}
        testID="browser-developer-remote-warning"
      />
      <UserScriptsSheet visible={scripts} onClose={() => setScripts(false)} />
    </DsScreen>
  );
});
