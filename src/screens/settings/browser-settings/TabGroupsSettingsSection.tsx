import { memo } from 'react';

import { Switch } from '@/components/inputs/Switch';
import { useTranslation } from '@/localization';
import { useSettingsStore } from '@/store/settings';

import { SettingsRow, SettingsSection } from '../components';

/** B2 #258 — Browser settings → Tab groups: tabs opened from a page join its group (off by default). */
export const TabGroupsSettingsSection = memo(function TabGroupsSettingsSection() {
  const { t } = useTranslation();
  const update = useSettingsStore((s) => s.updateSetting);
  const on = useSettingsStore((s) => s.groupTabsFromOpener === true);
  return (
    <SettingsSection testID="browser-settings-tab-groups" title={t('browserTabGroups.section')} icon="group">
      <SettingsRow
        title={t('browserTabGroups.openerSetting')}
        description={t('browserTabGroups.openerSettingHint')}
        icon="group"
        showDivider={false}
        trailing={<Switch value={on} onValueChange={(v) => update('groupTabsFromOpener', v)} accessibilityLabel={t('browserTabGroups.openerSetting')} testID="browser-settings-group-opener" />}
      />
    </SettingsSection>
  );
});
