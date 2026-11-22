import { memo, useCallback, useEffect, useMemo, useState } from 'react';
import { View } from 'react-native';

import { blockedCountForTab, blockedThisWeek } from '@/browser/blocking/content-blocking.service';
import { cleartextAllowed } from '@/browser/privacy/privacy.service';
import { COOKIE_POLICIES, normalizeCookiePolicy, type CookiePolicy } from '@/browser/privacy/privacy-settings';
import { SitePermissionsSheet } from '@/browser/site-permissions/components/SitePermissionsSheet';
import { useBrowserStore } from '@/browser/stores';
import { DsCard, DsHeader, DsIcon, DsRow, DsRowGroup, DsScreen, DsSectionLabel, DsText } from '@/design';
import { useTranslation, type TranslationKey } from '@/localization';
import { navigation, routePaths } from '@/navigation';
import { BlockingSettingsSection } from '@/screens/settings/browser-settings/BlockingSettingsSection';
import { ChoiceSheet, type ChoiceOption } from '@/screens/settings/browser-settings/ChoiceSheet';
import { PrivacySettingsSection, SiteDataSheet } from '@/screens/settings/browser-settings/PrivacySettingsSection';
import { useSettingsStore } from '@/store/settings';

import { notify, notifyNotAvailableYet } from './not-available';
import { SectionSheet } from './SectionSheet';

type Sheet = 'blocking' | 'cookies' | 'privacy' | 'permissions' | 'siteData' | null;

const COOKIE_SHORT: Record<CookiePolicy, TranslationKey> = {
  'allow-all': 'lightPrivacy.cookieAllowAll',
  'block-third-party': 'lightPrivacy.cookieBlockThirdParty',
  'block-all': 'lightPrivacy.cookieBlockAll',
};
const COOKIE_FULL: Record<CookiePolicy, { label: TranslationKey; hint: TranslationKey }> = {
  'allow-all': { label: 'browserPrivacy.cookiesAllowAll', hint: 'browserPrivacy.cookiesAllowAllHint' },
  'block-third-party': { label: 'browserPrivacy.cookiesBlockThirdParty', hint: 'browserPrivacy.cookiesBlockThirdPartyHint' },
  'block-all': { label: 'browserPrivacy.cookiesBlockAll', hint: 'browserPrivacy.cookiesBlockAllHint' },
};

const BLOCKED_POLL_MS = 5_000;

/**
 * The card's number, refreshed every 5 s: ads and trackers blocked over the last 7 days (counted on the phone), or —
 * on a native build without the weekly count — the requests blocked on the page in front (B14's per-tab count).
 */
function useBlockedCount(): { count: number | null; week: boolean } {
  const tabId = useBrowserStore((s) => s.activeTabId);
  const [state, setState] = useState<{ count: number | null; week: boolean }>({ count: null, week: false });
  useEffect(() => {
    let cancelled = false;
    const read = () => {
      const week = blockedThisWeek();
      if (week != null) {
        setState({ count: week, week: true });
        return;
      }
      blockedCountForTab(tabId)
        .then((value) => {
          if (!cancelled) setState({ count: value, week: false });
        })
        .catch(() => undefined);
    };
    read();
    const timer = setInterval(read, BLOCKED_POLL_MS);
    return () => {
      cancelled = true;
      clearInterval(timer);
    };
  }, [tabId]);
  return state;
}

/**
 * Design 5 "Privacy & security": the blocked count card, the blocker / HTTPS / cookie rows and the per-site rows,
 * over B12 (privacy), B14 (blocking) and B13 (site permissions).
 */
export const BrowserPrivacyScreen = memo(function BrowserPrivacyScreen() {
  const { t, language, rtl } = useTranslation();
  const update = useSettingsStore((s) => s.updateSetting);
  const adBlocker = useSettingsStore((s) => s.adBlocker === true);
  const trackerBlocker = useSettingsStore((s) => s.trackerBlocker === true);
  const httpsOnly = useSettingsStore((s) => s.httpsOnly === true);
  const doNotTrack = useSettingsStore((s) => s.doNotTrack === true);
  const cookiePolicy = normalizeCookiePolicy(useSettingsStore((s) => s.cookiePolicy));
  // A build that can't open plain http (release) is always HTTPS-only.
  const secureOnly = !cleartextAllowed();
  const { count: blocked, week: blockedWeek } = useBlockedCount();
  const [sheet, setSheet] = useState<Sheet>(null);
  const close = useCallback(() => setSheet(null), []);
  const back = useCallback(() => navigation.back(), []);
  const openSettings = useCallback(() => navigation.push(routePaths.browserSettings), []);

  const protection = adBlocker && trackerBlocker;
  const blockedLabel = blocked == null ? '—' : blocked.toLocaleString(language === 'ur' ? 'ur-PK' : 'en-GB');

  const cookieOptions = useMemo(
    (): ChoiceOption<CookiePolicy>[] =>
      COOKIE_POLICIES.map((value) => ({
        value,
        label: t(COOKIE_FULL[value].label),
        description: t(COOKIE_FULL[value].hint),
      })),
    [t],
  );

  return (
    <DsScreen testID="browser-privacy-screen">
      <DsHeader
        title={t('lightPrivacy.title')}
        subtitle={protection ? t('lightPrivacy.protectionOn') : t('lightPrivacy.protectionOff')}
        action={{
          icon: 'settings',
          accessibilityLabel: t('lightPrivacy.openSettingsA11y'),
          onPress: openSettings,
          testID: 'browser-privacy-settings',
        }}
      />

      <DsCard style={{ alignItems: 'center', paddingVertical: 22 }} testID="browser-privacy-blocked">
        <View
          accessible
          accessibilityLabel={t(blockedWeek ? 'lightPrivacy.blockedWeekA11y' : 'lightPrivacy.blockedA11y', { count: blocked ?? 0 })}
          style={{ alignItems: 'center', gap: 4 }}>
          <View style={{ flexDirection: rtl.rowDirection, alignItems: 'center', gap: 10 }}>
            <DsIcon name="shield" size={30} color="success" strokeWidth={2.4} />
            <DsText variant="stat" color="success" numberOfLines={1}>
              {blockedLabel}
            </DsText>
          </View>
          <DsText variant="body" align="center">
            {t(blockedWeek ? 'lightPrivacy.blockedWeek' : 'lightPrivacy.blocked')}
          </DsText>
        </View>
      </DsCard>

      <DsRowGroup testID="browser-privacy-rows">
        <DsRow
          icon="ban"
          title={t('lightPrivacy.adBlocker')}
          toggle={{
            value: protection,
            onValueChange: (next) => {
              update('adBlocker', next);
              update('trackerBlocker', next);
            },
          }}
          onPress={() => setSheet('blocking')}
          accessibilityHint={t('lightPrivacy.adBlockerHint')}
          testID="browser-privacy-blocker"
        />
        <DsRow
          icon="lock"
          title={t('browserPrivacy.httpsOnly')}
          toggle={{
            value: secureOnly || httpsOnly,
            onValueChange: (next) => (secureOnly ? notify(t('browserPrivacy.httpsOnlyAlways')) : update('httpsOnly', next)),
            accessibilityLabel: t('browserPrivacy.httpsOnly'),
          }}
          testID="browser-privacy-https"
        />
        <DsRow
          icon="alert-triangle"
          title={t('lightPrivacy.phishing')}
          subtitle={t('lightPrivacy.phishingSub')}
          toggle={{ value: true, onValueChange: () => notify(t('lightPrivacy.phishingAlwaysOn')), accessibilityHint: t('lightPrivacy.phishingAlwaysOn') }}
          testID="browser-privacy-phishing"
        />
        <DsRow
          icon="circle"
          title={t('lightPrivacy.cookies')}
          subtitle={t(COOKIE_SHORT[cookiePolicy])}
          onPress={() => setSheet('cookies')}
          testID="browser-privacy-cookies"
        />
        <DsRow
          icon="user"
          title={t('lightPrivacy.fingerprint')}
          toggle={{ value: false, onValueChange: notifyNotAvailableYet }}
          testID="browser-privacy-fingerprint"
        />
        <DsRow icon="sliders-horizontal" title={t('lightPrivacy.proxy')} onPress={() => setSheet('privacy')} testID="browser-privacy-proxy" />
      </DsRowGroup>

      <DsSectionLabel>{t('lightPrivacy.perSite')}</DsSectionLabel>
      <DsRowGroup testID="browser-privacy-per-site">
        <DsRow
          icon="circle"
          title={t('lightPrivacy.sitePermissions')}
          subtitle={t('lightPrivacy.sitePermissionsHint')}
          onPress={() => setSheet('permissions')}
          testID="browser-privacy-permissions"
        />
        <DsRow icon="file-text" title={t('lightPrivacy.certificate')} onPress={() => setSheet('siteData')} testID="browser-privacy-site-data" />
        <DsRow
          icon="eye-off"
          title={t('lightPrivacy.doNotTrack')}
          toggle={{ value: doNotTrack, onValueChange: (next) => update('doNotTrack', next) }}
          testID="browser-privacy-dnt"
        />
      </DsRowGroup>

      <ChoiceSheet
        visible={sheet === 'cookies'}
        title={t('lightPrivacy.cookies')}
        options={cookieOptions}
        value={cookiePolicy}
        onSelect={(next) => update('cookiePolicy', next)}
        onClose={close}
        testID="browser-privacy-cookies-sheet"
      />
      <SectionSheet visible={sheet === 'blocking'} title={t('lightPrivacy.adBlocker')} onClose={close} testID="browser-privacy-blocking-sheet">
        <BlockingSettingsSection />
      </SectionSheet>
      <SectionSheet visible={sheet === 'privacy'} title={t('lightPrivacy.proxy')} onClose={close} testID="browser-privacy-proxy-sheet">
        <DsText variant="body">{t('lightPrivacy.proxyNote')}</DsText>
        <PrivacySettingsSection />
      </SectionSheet>
      <SitePermissionsSheet site={sheet === 'permissions' ? '' : null} onClose={close} />
      <SiteDataSheet visible={sheet === 'siteData'} onClose={close} />
    </DsScreen>
  );
});
