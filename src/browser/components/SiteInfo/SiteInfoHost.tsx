import { memo, useCallback, useEffect, useState } from 'react';
import { Modal, Pressable as RNPressable, ScrollView, StyleSheet, View } from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import type { PageCertificate } from '@modules/vidorax-web';

import { Box } from '@/components/base/Box';
import { Icon } from '@/components/base/Icon';
import { Pressable } from '@/components/base/Pressable';
import { Text } from '@/components/base/Text';
import { Divider } from '@/components/common/Divider';
import { Switch } from '@/components/inputs/Switch';
import { ConfirmModal } from '@/components/modals/ConfirmModal';
import { formatStorageSize } from '@/browser/privacy/format-bytes';
import { isSecurityFailure } from '@/browser/privacy/https-upgrade';
import {
  clearSiteDataForHost,
  cookieCountFor,
  getPageCertificate,
  listSiteData,
  listSiteDataAfterClear,
} from '@/browser/privacy/privacy.service';
import {
  isJavaScriptAllowed,
  normalizeCookiePolicy,
  parseJavaScriptExceptions,
  serializeJavaScriptExceptions,
  siteKey,
  withJavaScriptForSite,
} from '@/browser/privacy/privacy-settings';
import { announceProfileMessage } from '@/browser/profiles/profile-feedback';
import { reloadForTab } from '@/browser/services';
import { useBrowserStore } from '@/browser/stores';
import { useTheme } from '@/hooks/use-theme';
import { useTranslation } from '@/localization';
import { navigation, routePaths } from '@/navigation';
import { useSettingsStore } from '@/store/settings';
import { useTourBlocker } from '@/tour/tour-store';

import { siteInfoRequests } from './site-info-requests';

type Details = { certificate: PageCertificate | null; cookies: number; storage: number };

/**
 * B12 site information, from the lock icon in the address bar: whether the connection is secure, the page's
 * certificate (#125), the site's cookies and stored data with Clear site data (#130), and JavaScript for this site
 * (#135).
 */
export const SiteInfoHost = memo(function SiteInfoHost() {
  const theme = useTheme();
  const insets = useSafeAreaInsets();
  const { t, rtl, language } = useTranslation();
  const [visible, setVisible] = useState(false);
  const [details, setDetails] = useState<Details | null>(null);
  const [confirmClear, setConfirmClear] = useState(false);
  const activeTabId = useBrowserStore((s) => s.activeTabId);
  const url = useBrowserStore((s) => s.currentUrl);
  const securityFailed = useBrowserStore((s) => isSecurityFailure(s.error?.code));
  const javaScriptDefault = useSettingsStore((s) => s.javaScript !== false);
  // WebView still keeps cookies sites set while all are blocked; it just never sends them.
  const cookiesBlocked = useSettingsStore((s) => normalizeCookiePolicy(s.cookiePolicy) === 'block-all');
  const exceptionsRaw = useSettingsStore((s) => s.javaScriptExceptions);
  const update = useSettingsStore((s) => s.updateSetting);

  const site = siteKey(url);
  let host = '';
  let secure = false;
  try {
    const parsed = new URL(url);
    host = parsed.hostname;
    secure = parsed.protocol === 'https:' && !securityFailed;
  } catch {
    // Not a web page: the sheet doesn't open.
  }
  const exceptions = parseJavaScriptExceptions(exceptionsRaw);
  const javaScriptOn = isJavaScriptAllowed(url, javaScriptDefault, exceptions);

  const load = useCallback(async (afterClear = false) => {
    setDetails(null);
    const [certificate, origins] = await Promise.all([
      getPageCertificate(activeTabId),
      afterClear ? listSiteDataAfterClear() : listSiteData(),
    ]);
    const pageHost = (() => {
      try {
        return new URL(useBrowserStore.getState().currentUrl).hostname;
      } catch {
        return '';
      }
    })();
    const storage = origins
      .filter((entry) => {
        try {
          return new URL(entry.origin).hostname === pageHost;
        } catch {
          return false;
        }
      })
      .reduce((sum, entry) => sum + entry.usage, 0);
    setDetails({ certificate, cookies: cookieCountFor(useBrowserStore.getState().currentUrl), storage });
  }, [activeTabId]);

  useEffect(
    () =>
      siteInfoRequests.subscribe(() => {
        setVisible(true);
        void load();
      }),
    [load],
  );

  useTourBlocker(visible);

  const close = () => setVisible(false);

  const toggleJavaScript = (next: boolean) => {
    if (!site) return;
    update('javaScriptExceptions', serializeJavaScriptExceptions(withJavaScriptForSite(exceptions, site, next, javaScriptDefault)));
    // The WebView takes the new setting on the next load.
    setTimeout(() => reloadForTab(activeTabId), 50);
  };

  const clearData = async () => {
    setConfirmClear(false);
    if (!host) return;
    await clearSiteDataForHost(host);
    announceProfileMessage(t('browserPrivacy.cleared'));
    void load(true);
  };

  if (!visible || !site) return null;

  const formatDate = (ms: number | null | undefined) =>
    ms ? new Date(ms).toLocaleDateString(language === 'ur' ? 'ur-PK' : 'en-GB', { year: 'numeric', month: 'short', day: 'numeric' }) : '—';
  const storageLabel = (() => {
    if (!details) return t('browserPrivacy.siteDataLoading');
    if (details.storage <= 0) return t('browserPrivacy.storageNone');
    const size = formatStorageSize(details.storage);
    return size.unit === 'mb' ? t('browserPrivacy.sizeMb', { size: size.size }) : t('browserPrivacy.sizeKb', { size: size.size });
  })();
  const certificate = details?.certificate ?? null;
  const party = (name: string | null, org: string | null) => [name, org].filter(Boolean).join(' · ') || '—';

  return (
    <Modal visible transparent animationType="fade" onRequestClose={close} statusBarTranslucent>
      <View style={styles.root}>
        <RNPressable
          accessibilityRole="button"
          accessibilityLabel={t('common.dismiss')}
          onPress={close}
          style={[StyleSheet.absoluteFill, { backgroundColor: `rgba(0,0,0,${theme.opacity.overlay})` }]}
        />
        <View
          testID="browser-site-info"
          style={{
            backgroundColor: theme.colors.card,
            borderTopLeftRadius: theme.radius.xl,
            borderTopRightRadius: theme.radius.xl,
            paddingTop: 8,
            paddingBottom: insets.bottom + 12,
            maxHeight: '88%',
          }}>
          <View style={[styles.handle, { backgroundColor: theme.colors.border }]} />
          <ScrollView contentContainerStyle={{ paddingHorizontal: 16, gap: 12 }}>
            <Text variant="title" accessibilityRole="header" numberOfLines={2} style={{ textAlign: rtl.textAlign }}>
              {host}
            </Text>
            <Box row rtlRow gap={12} style={{ alignItems: 'flex-start' }}>
              <Icon name={secure ? 'lock' : 'lock-open-variant'} size={22} color={secure ? 'success' : 'warning'} />
              <Box flex={1} style={{ minWidth: 0 }}>
                <Text variant="label" style={{ textAlign: rtl.textAlign }}>
                  {secure ? t('browserPrivacy.connectionSecure') : t('browserPrivacy.connectionInsecure')}
                </Text>
                <Text variant="caption" color="textSecondary" style={{ textAlign: rtl.textAlign }}>
                  {secure ? t('browserPrivacy.connectionSecureHint') : t('browserPrivacy.connectionInsecureHint')}
                </Text>
              </Box>
            </Box>
            {secure ? (
              <Box gap={6} testID="browser-site-info-certificate">
                <Text variant="label" accessibilityRole="header" style={{ textAlign: rtl.textAlign }}>
                  {t('browserPrivacy.certificate')}
                </Text>
                {certificate ? (
                  <>
                    <Row label={t('browserPrivacy.certIssuedTo')} value={party(certificate.issuedToName, certificate.issuedToOrganization)} />
                    <Row label={t('browserPrivacy.certIssuedBy')} value={party(certificate.issuedByName, certificate.issuedByOrganization)} />
                    <Row
                      label={t('browserPrivacy.certValid')}
                      value={t('browserPrivacy.certValidRange', {
                        from: formatDate(certificate.validFrom),
                        until: formatDate(certificate.validUntil),
                      })}
                    />
                    {certificate.sha256 ? (
                      // Byte groups with spaces, so the line wraps between groups.
                      <Row label={t('browserPrivacy.certFingerprint')} value={certificate.sha256.replace(/:/g, ' ')} selectable />
                    ) : null}
                  </>
                ) : (
                  <Text variant="caption" color="textSecondary" style={{ textAlign: rtl.textAlign }}>
                    {details ? t('browserPrivacy.certUnavailable') : t('browserPrivacy.siteDataLoading')}
                  </Text>
                )}
              </Box>
            ) : null}
            <Divider />
            <Row
              label={t('browserPrivacy.cookiesForSite')}
              value={
                details
                  ? t(cookiesBlocked ? 'browserPrivacy.cookiesForSiteBlocked' : 'browserPrivacy.cookiesForSiteCount', {
                      count: details.cookies,
                    })
                  : t('browserPrivacy.siteDataLoading')
              }
            />
            <Row label={t('browserPrivacy.storageForSite')} value={storageLabel} />
            <Box row rtlRow center gap={12} style={{ minHeight: 56 }}>
              <Box flex={1} style={{ minWidth: 0 }}>
                <Text variant="body" style={{ textAlign: rtl.textAlign }}>
                  {t('browserPrivacy.javaScriptForSite')}
                </Text>
                <Text variant="caption" color="textSecondary" style={{ textAlign: rtl.textAlign }}>
                  {t('browserPrivacy.javaScriptForSiteHint')}
                </Text>
              </Box>
              <Switch
                value={javaScriptOn}
                onValueChange={toggleJavaScript}
                accessibilityLabel={t('browserPrivacy.javaScriptForSite')}
                accessibilityHint={t('browserPrivacy.javaScriptForSiteHint')}
                testID="browser-site-info-javascript"
              />
            </Box>
            <Box row rtlRow gap={8} style={{ flexWrap: 'wrap', justifyContent: 'flex-end' }}>
              <Pressable
                accessibilityRole="button"
                accessibilityLabel={t('browserPrivacy.privacySettings')}
                onPress={() => {
                  close();
                  navigation.push(routePaths.browserSettings);
                }}
                style={styles.button}>
                <Text variant="button" color="textSecondary">
                  {t('browserPrivacy.privacySettings')}
                </Text>
              </Pressable>
              <Pressable
                accessibilityRole="button"
                accessibilityLabel={t('browserPrivacy.clearSiteData')}
                onPress={() => setConfirmClear(true)}
                testID="browser-site-info-clear"
                style={[styles.button, { backgroundColor: theme.colors.primary, borderRadius: theme.radius.md }]}>
                <Text variant="button" color="textOnPrimary">
                  {t('browserPrivacy.clearSiteData')}
                </Text>
              </Pressable>
            </Box>
          </ScrollView>
        </View>
      </View>
      <ConfirmModal
        visible={confirmClear}
        variant="delete"
        title={t('browserPrivacy.clearSiteTitle', { site: host })}
        message={t('browserPrivacy.clearSiteMessage')}
        confirmLabel={t('browserPrivacy.clearSite')}
        cancelLabel={t('common.cancel')}
        onConfirm={() => void clearData()}
        onCancel={() => setConfirmClear(false)}
        testID="browser-site-info-clear-confirm"
      />
    </Modal>
  );
});

const Row = memo(function Row({ label, value, selectable = false }: { label: string; value: string; selectable?: boolean }) {
  const { rtl } = useTranslation();
  return (
    <Box row rtlRow gap={12} style={{ alignItems: 'flex-start' }}>
      <Text variant="caption" color="textSecondary" style={{ width: 110, textAlign: rtl.textAlign }}>
        {label}
      </Text>
      <Text variant="bodySmall" selectable={selectable} style={{ flex: 1, minWidth: 0, textAlign: rtl.textAlign }}>
        {value}
      </Text>
    </Box>
  );
});

const styles = StyleSheet.create({
  root: { flex: 1, justifyContent: 'flex-end' },
  handle: { alignSelf: 'center', width: 40, height: 4, borderRadius: 2, marginBottom: 12 },
  button: { minHeight: 48, minWidth: 88, paddingHorizontal: 16, alignItems: 'center', justifyContent: 'center' },
});
