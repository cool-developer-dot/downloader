import { memo, useState } from 'react';

import { DsHeader, DsRow, DsRowGroup, DsScreen } from '@/design';
import { useTranslation } from '@/localization';

import { useNotYet } from '../shared/use-not-yet';
import { useSettingsHeaderAction } from '../shared/use-settings-header-action';

import { HeadersModal } from './HeadersModal';
import { UserAgentModal } from './UserAgentModal';

/**
 * Design 44 "Network": the H15 network options that exist (custom headers, custom user agent) and the rows the
 * design draws for features that do not exist yet (proxy, SSL switch, IPv6, multi-network, remote control, extension
 * bridge, CLI). TLS is always verified and never configurable, so the SSL switch shows on and says so when tapped.
 */
export const NetworkScreen = memo(function NetworkScreen() {
  const { t } = useTranslation();
  const notYet = useNotYet();
  const settingsAction = useSettingsHeaderAction();
  const [headersOpen, setHeadersOpen] = useState(false);
  const [agentOpen, setAgentOpen] = useState(false);

  return (
    <DsScreen testID="network-screen">
      <DsHeader title={t('lightNetwork.title')} subtitle={t('settings.advancedSection')} action={settingsAction} />
      <DsRowGroup testID="network-rows">
        <DsRow icon="globe" title={t('lightNetwork.proxySocks')} onPress={notYet} testID="network-proxy" />
        <DsRow icon="file-text" title={t('lightNetwork.customHeadersReferer')} onPress={() => setHeadersOpen(true)} testID="network-headers" />
        <DsRow icon="cpu" title={t('lightNetwork.customUserAgent')} onPress={() => setAgentOpen(true)} testID="network-user-agent" />
        <DsRow icon="lock" title={t('lightNetwork.sslVerification')} toggle={{ value: true, onValueChange: notYet }} testID="network-ssl" />
        <DsRow icon="cast" title={t('lightNetwork.ipv6Support')} toggle={{ value: false, onValueChange: notYet }} testID="network-ipv6" />
        <DsRow icon="shuffle" title={t('lightNetwork.multiNetwork')} toggle={{ value: false, onValueChange: notYet }} testID="network-multi" />
        <DsRow icon="cast" title={t('lightNetwork.remoteControl')} toggle={{ value: false, onValueChange: notYet }} testID="network-remote" />
        <DsRow icon="link" title={t('lightNetwork.extensionBridge')} onPress={notYet} testID="network-extension" />
        <DsRow icon="terminal" title={t('lightNetwork.cliApi')} onPress={notYet} testID="network-cli" />
      </DsRowGroup>

      <HeadersModal visible={headersOpen} onClose={() => setHeadersOpen(false)} />
      <UserAgentModal visible={agentOpen} onClose={() => setAgentOpen(false)} />
    </DsScreen>
  );
});
