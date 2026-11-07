import { memo, useMemo, useState } from 'react';

import { SitePermissionsSheet } from '@/browser/site-permissions/components/SitePermissionsSheet';
import { parseSitePermissions } from '@/browser/site-permissions/site-permissions';
import { useTranslation } from '@/localization';
import { useSettingsStore } from '@/store/settings';

import { SettingsRow, SettingsSection } from '../components';

/** B13 #116 — Browser settings → Site permissions: every site that asked for something, with Reset. */
export const SitePermissionsSection = memo(function SitePermissionsSection() {
  const { t } = useTranslation();
  const raw = useSettingsStore((s) => s.sitePermissions);
  const count = useMemo(() => Object.keys(parseSitePermissions(raw)).length, [raw]);
  const [open, setOpen] = useState(false);
  const value = t('browserSitePermissions.siteCount', { count });

  return (
    <SettingsSection
      testID="browser-settings-site-permissions"
      title={t('browserSitePermissions.section')}
      description={t('browserSitePermissions.sectionDescription')}
      icon="shield-lock-outline">
      <SettingsRow
        title={t('browserSitePermissions.manage')}
        description={t('browserSitePermissions.manageHint')}
        icon="web"
        value={value}
        onPress={() => setOpen(true)}
        showDivider={false}
        testID="browser-settings-site-permissions-open"
      />
      <SitePermissionsSheet site={open ? '' : null} onClose={() => setOpen(false)} />
    </SettingsSection>
  );
});
