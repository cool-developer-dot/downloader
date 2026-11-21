import { memo, useCallback, useEffect, useState } from 'react';

import { DsHeader, DsRow, DsRowGroup, DsScreen } from '@/design';
import { multiNetworkForEngine } from '@/downloads/v2/sources';
import { useTranslation } from '@/localization';
import { navigation } from '@/navigation';
import { isRemoteControlAvailable, refreshRemoteState, setAllowOtherApps, useRemoteStore } from '@/remote/remote-control';
import { REMOTE_CONTROL_ROUTE } from '@/screens/settings/download-settings/RemoteControlSettingsSection';
import { selectMultiNetwork, selectWifiOnly, useSettingsStore } from '@/store/settings';

import { useNotYet } from '../shared/use-not-yet';
import { toast as showToast } from '../shared/toast';
import { useSettingsHeaderAction } from '../shared/use-settings-header-action';

import { HeadersModal } from './HeadersModal';
import { UserAgentModal } from './UserAgentModal';

/**
 * Design 44 "Network": custom headers and user agent (H15), Wi-Fi + mobile data together (#446), Remote control &
 * Web UI, the browser extension bridge and the automation API (P6 #438/#439/#500/#499/#501). Certificates are always
 * checked and IPv6 is used whenever the network has it, so those two switches show on and say so when tapped. A
 * proxy is not part of VidoraX.
 */
export const NetworkScreen = memo(function NetworkScreen() {
  const { t } = useTranslation();
  const notYet = useNotYet();
  const settingsAction = useSettingsHeaderAction();
  const [headersOpen, setHeadersOpen] = useState(false);
  const [agentOpen, setAgentOpen] = useState(false);
  const multiNetwork = useSettingsStore(selectMultiNetwork);
  const wifiOnly = useSettingsStore(selectWifiOnly);
  const remoteAvailable = isRemoteControlAvailable();
  const remoteStatus = useRemoteStore((state) => state.status);
  const allowOtherApps = useRemoteStore((state) => state.allowOtherApps);

  useEffect(() => {
    if (remoteAvailable) void refreshRemoteState().catch(() => undefined);
  }, [remoteAvailable]);

  const openRemote = useCallback(() => (remoteAvailable ? navigation.push(REMOTE_CONTROL_ROUTE) : notYet()), [notYet, remoteAvailable]);
  const sslAlwaysOn = useCallback(() => showToast(t('lightNetwork.sslAlwaysOn')), [t]);
  const ipv6AlwaysOn = useCallback(() => showToast(t('lightNetwork.ipv6AlwaysOn')), [t]);

  return (
    <DsScreen testID="network-screen">
      <DsHeader title={t('lightNetwork.title')} subtitle={t('settings.advancedSection')} action={settingsAction} />
      <DsRowGroup testID="network-rows">
        <DsRow icon="globe" title={t('lightNetwork.proxySocks')} onPress={notYet} testID="network-proxy" />
        <DsRow icon="file-text" title={t('lightNetwork.customHeadersReferer')} onPress={() => setHeadersOpen(true)} testID="network-headers" />
        <DsRow icon="cpu" title={t('lightNetwork.customUserAgent')} onPress={() => setAgentOpen(true)} testID="network-user-agent" />
        <DsRow
          icon="lock"
          title={t('lightNetwork.sslVerification')}
          toggle={{ value: true, onValueChange: sslAlwaysOn, accessibilityHint: t('lightNetwork.sslAlwaysOn') }}
          testID="network-ssl"
        />
        <DsRow
          icon="cast"
          title={t('lightNetwork.ipv6Support')}
          toggle={{ value: true, onValueChange: ipv6AlwaysOn, accessibilityHint: t('lightNetwork.ipv6AlwaysOn') }}
          testID="network-ipv6"
        />
        <DsRow
          icon="shuffle"
          title={t('lightNetwork.multiNetwork')}
          subtitle={wifiOnly ? t('downloadSources.multiNetworkWifiOnly') : t('lightDownloadSettings.experimental')}
          toggle={{
            value: multiNetworkForEngine(multiNetwork, wifiOnly),
            onValueChange: (value) => useSettingsStore.getState().updateSetting('multiNetwork', value),
            accessibilityHint: t('downloadSources.multiNetworkHint'),
          }}
          disabled={wifiOnly}
          testID="network-multi"
        />
        <DsRow
          icon="monitor"
          title={t('lightNetwork.remoteControl')}
          subtitle={remoteStatus.running && remoteStatus.url ? remoteStatus.url : t('common.off')}
          onPress={openRemote}
          testID="network-remote"
        />
        <DsRow icon="link" title={t('lightNetwork.extensionBridge')} subtitle={t('lightNetwork.extensionBridgeSub')} onPress={openRemote} testID="network-extension" />
        {remoteAvailable ? (
          <DsRow
            icon="terminal"
            title={t('lightNetwork.cliApi')}
            subtitle={t('remoteControl.allowApps')}
            toggle={{ value: allowOtherApps, onValueChange: (value) => void setAllowOtherApps(value), accessibilityHint: t('remoteControl.allowAppsHint') }}
            testID="network-cli"
          />
        ) : (
          <DsRow icon="terminal" title={t('lightNetwork.cliApi')} onPress={notYet} testID="network-cli" />
        )}
      </DsRowGroup>

      <HeadersModal visible={headersOpen} onClose={() => setHeadersOpen(false)} />
      <UserAgentModal visible={agentOpen} onClose={() => setAgentOpen(false)} />
    </DsScreen>
  );
});
