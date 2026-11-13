import { memo, useMemo, useSyncExternalStore } from 'react';
import { AccessibilityInfo, Platform, ToastAndroid, View } from 'react-native';

import { Box } from '@/components/base/Box';
import { Text } from '@/components/base/Text';
import { Button } from '@/components/buttons/Button';
import { Divider } from '@/components/common/Divider';
import { Switch } from '@/components/inputs/Switch';
import { SheetFrame } from '@/browser/startup/components/SheetFrame';
import { useTranslation, type TranslationKey } from '@/localization';
import { useSettingsStore } from '@/store/settings';

import { parseSitePermissions, SITE_PERMISSION_KINDS, sitePermissionList, type SitePermissionKind } from '../site-permissions';
import { sitePermissionActions, sitePermissionsSheet } from '../site-permissions.service';

const KIND_LABELS: Record<SitePermissionKind, TranslationKey> = {
  location: 'browserSitePermissions.location',
  camera: 'browserSitePermissions.camera',
  microphone: 'browserSitePermissions.microphone',
  notifications: 'browserSitePermissions.notifications',
};

/**
 * B13 #116 — Site permissions: each site with what it asked for (Blocked) and its pop-up choice, Reset for one site,
 * Reset all. `site` shows just that site (from the lock icon or the bar); '' shows every site.
 */
export const SitePermissionsSheet = memo(function SitePermissionsSheet({
  site,
  onClose,
}: {
  /** null = hidden; '' = all sites. */
  site: string | null;
  onClose: () => void;
}) {
  const { t, rtl } = useTranslation();
  const raw = useSettingsStore((s) => s.sitePermissions);
  const all = useMemo(() => sitePermissionList(parseSitePermissions(raw)), [raw]);
  const list = site ? all.filter((row) => row.site === site) : all;
  // The site from the lock icon is shown even before it asked for anything (its pop-up switch).
  const rows = site && list.length === 0 ? [{ site, entry: { blocked: [], popupsAllowed: false, updatedAt: 0 } }] : list;

  return (
    <SheetFrame
      visible={site != null}
      title={site ? site : t('browserSitePermissions.manage')}
      onClose={onClose}
      testID="site-permissions-sheet"
      footer={
        !site && all.length > 0 ? (
          <Button
            title={t('browserSitePermissions.resetAll')}
            variant="outline"
            leftIcon="restore"
            onPress={() => {
              sitePermissionActions.resetAll();
              const message = t('browserSitePermissions.resetAllDone');
              if (Platform.OS === 'android') ToastAndroid.show(message, ToastAndroid.SHORT);
              AccessibilityInfo.announceForAccessibility(message);
            }}
            testID="site-permissions-reset-all"
          />
        ) : undefined
      }>
      <Text variant="caption" color="textSecondary" style={{ marginBottom: 8 }}>
        {t('browserSitePermissions.alwaysBlockedNote')}
      </Text>
      {rows.length === 0 ? (
        <Text variant="body" color="textSecondary" style={{ paddingVertical: 16 }}>
          {t('browserSitePermissions.empty')}
        </Text>
      ) : null}
      {rows.map(({ site: host, entry }, index) => (
        <Box key={host} style={{ paddingVertical: 8 }}>
          {index > 0 ? <Divider /> : null}
          <View style={{ flexDirection: rtl.rowDirection, alignItems: 'center', gap: 8, paddingTop: 8 }}>
            <Text variant="label" accessibilityRole="header" style={{ flex: 1 }} numberOfLines={2}>
              {host}
            </Text>
            <Button
              title={t('browserSitePermissions.resetSite')}
              variant="ghost"
              accessibilityLabel={t('browserSitePermissions.resetSiteA11y', { site: host })}
              onPress={() => sitePermissionActions.resetSite(host)}
              testID={`site-permissions-reset-${host}`}
            />
          </View>
          {SITE_PERMISSION_KINDS.filter((kind) => entry.blocked.includes(kind)).map((kind) => (
            <View
              key={kind}
              accessible
              accessibilityLabel={`${t(KIND_LABELS[kind])}: ${t('browserSitePermissions.blocked')}`}
              style={{ minHeight: 40, flexDirection: rtl.rowDirection, alignItems: 'center', gap: 8 }}>
              <Text variant="body" style={{ flex: 1 }}>
                {t(KIND_LABELS[kind])}
              </Text>
              <Text variant="body" color="error">
                {t('browserSitePermissions.blocked')}
              </Text>
            </View>
          ))}
          <View style={{ minHeight: 48, flexDirection: rtl.rowDirection, alignItems: 'center', gap: 8 }}>
            <View style={{ flex: 1 }}>
              <Text variant="body">{t('browserSitePermissions.allowPopups')}</Text>
              <Text variant="caption" color="textSecondary">
                {t('browserSitePermissions.allowPopupsHint')}
              </Text>
            </View>
            <Switch
              value={entry.popupsAllowed}
              onValueChange={(next) => sitePermissionActions.setPopupsAllowed(host, next)}
              accessibilityLabel={`${t('browserSitePermissions.allowPopups')}, ${host}`}
              accessibilityHint={t('browserSitePermissions.allowPopupsHint')}
              testID={`site-permissions-popups-${host}`}
            />
          </View>
        </Box>
      ))}
    </SheetFrame>
  );
});

/** Shows the sheet when the bar or the lock icon asks for it (rendered once by the browser screen). */
export const SitePermissionsHost = memo(function SitePermissionsHost() {
  const site = useSyncExternalStore(sitePermissionsSheet.subscribe, sitePermissionsSheet.get, sitePermissionsSheet.get);
  return <SitePermissionsSheet site={site} onClose={() => sitePermissionsSheet.close()} />;
});
