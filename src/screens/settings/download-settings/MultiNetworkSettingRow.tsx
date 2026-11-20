import { memo } from 'react';

import { Switch } from '@/components/inputs/Switch';
import { multiNetworkForEngine } from '@/downloads/v2/sources';
import { useTranslation } from '@/localization';
import { selectMultiNetwork, useSettingsStore } from '@/store/settings';

import { SettingsRow } from '../components';

/**
 * #446 Download Settings → Performance: "Experimental: use Wi-Fi and mobile data together" (off by default). Shown off
 * and disabled while "Wi-Fi only" is on — the engine is never told to use mobile data then (settings.ts).
 */
export const MultiNetworkSettingRow = memo(function MultiNetworkSettingRow({ disabled }: { disabled: boolean }) {
  const { t } = useTranslation();
  const multiNetwork = useSettingsStore(selectMultiNetwork);
  const wifiOnly = useSettingsStore((s) => s.wifiOnly);
  const effective = multiNetworkForEngine(multiNetwork, wifiOnly);
  const hint = wifiOnly
    ? `${t('downloadSources.multiNetworkHint')} ${t('downloadSources.multiNetworkWifiOnly')}`
    : t('downloadSources.multiNetworkHint');
  return (
    <SettingsRow
      title={t('downloadSources.multiNetwork')}
      description={hint}
      icon="wifi-arrow-up-down"
      trailing={
        <Switch
          value={effective}
          onValueChange={(value) => useSettingsStore.getState().updateSetting('multiNetwork', value)}
          disabled={disabled || wifiOnly}
          accessibilityLabel={t('downloadSources.multiNetwork')}
          accessibilityHint={hint}
          testID="download-settings-multi-network-switch"
        />
      }
      accessibilityHint={hint}
      testID="download-settings-multi-network"
    />
  );
});
