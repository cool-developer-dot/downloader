import { memo, useCallback } from 'react';

import { DOWNLOAD_RULES_ROUTE } from '@/screens/download-rules/route';
import { WATCHED_LINKS_ROUTE } from '@/screens/watched-links/route';
import { SITE_GRABBER_ROUTE } from '@/screens/site-grabber/route';
import { Switch } from '@/components/inputs/Switch';
import { useTranslation } from '@/localization';
import { navigation } from '@/navigation';
import { selectClipboardMonitor, useSettingsStore } from '@/store/settings';

import { SettingsRow, SettingsSection, SettingsStaggerItem } from '../components';

/** The route of the Batch Add screen (`src/app/(app)/batch-add.tsx`). */
export const BATCH_ADD_ROUTE = '/batch-add';

/** Download Settings → Adding links: Clipboard Monitor (#291, off by default) and Batch Add (#292). */
export const LinkIntakeSettingsSection = memo(function LinkIntakeSettingsSection({
  index,
  disabled,
}: {
  index: number;
  disabled?: boolean;
}) {
  const { t } = useTranslation();
  const clipboardMonitor = useSettingsStore(selectClipboardMonitor);
  const openBatch = useCallback(() => navigation.push(BATCH_ADD_ROUTE), []);
  const openRules = useCallback(() => navigation.push(DOWNLOAD_RULES_ROUTE), []);
  const openWatched = useCallback(() => navigation.push(WATCHED_LINKS_ROUTE), []);
  const openSiteGrabber = useCallback(() => navigation.push(SITE_GRABBER_ROUTE), []);

  return (
    <SettingsStaggerItem index={index}>
      <SettingsSection
        testID="download-settings-link-intake"
        title={t('linkIntake.section')}
        description={t('linkIntake.sectionDescription')}
        icon="link-variant-plus">
        <SettingsRow
          title={t('linkIntake.clipboardSetting')}
          description={t('linkIntake.clipboardSettingHint')}
          icon="clipboard-text-outline"
          trailing={
            <Switch
              value={clipboardMonitor}
              onValueChange={(value) => useSettingsStore.getState().updateSetting('clipboardMonitor', value)}
              disabled={disabled}
              accessibilityLabel={t('linkIntake.clipboardSetting')}
              accessibilityHint={t('linkIntake.clipboardSettingHint')}
              testID="download-settings-clipboard-monitor-switch"
            />
          }
          testID="download-settings-clipboard-monitor"
        />
        <SettingsRow
          title={t('linkIntake.batchTitle')}
          description={t('linkIntake.batchRowHint')}
          icon="playlist-plus"
          onPress={openBatch}
          testID="download-settings-batch-add"
        />
        <SettingsRow
          title={t('bulkAdd.rulesRow')}
          description={t('bulkAdd.rulesRowHint')}
          icon="filter-variant"
          onPress={openRules}
          testID="download-settings-download-rules"
        />
        <SettingsRow
          title={t('watchedLinks.row')}
          description={t('watchedLinks.rowHint')}
          icon="eye-refresh-outline"
          onPress={openWatched}
          testID="download-settings-watched-links"
        />
        <SettingsRow
          title={t('siteGrabber.row')}
          description={t('siteGrabber.rowHint')}
          icon="web-sync"
          onPress={openSiteGrabber}
          showDivider={false}
          testID="download-settings-site-grabber"
        />
      </SettingsSection>
    </SettingsStaggerItem>
  );
});
