import { memo, useCallback, useMemo, useState } from 'react';
import { ActivityIndicator, Modal, Pressable as RNPressable, ScrollView, StyleSheet, View } from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import type { SiteDataEntry } from '@modules/vidorax-web';

import { Box } from '@/components/base/Box';
import { Icon } from '@/components/base/Icon';
import { Pressable } from '@/components/base/Pressable';
import { Text } from '@/components/base/Text';
import { Divider } from '@/components/common/Divider';
import { Switch } from '@/components/inputs/Switch';
import { ConfirmModal } from '@/components/modals/ConfirmModal';
import { formatStorageSize } from '@/browser/privacy/format-bytes';
import {
  cleartextAllowed,
  clearAllSiteData,
  clearSiteDataForOrigin,
  listSiteData,
  listSiteDataAfterClear,
} from '@/browser/privacy/privacy.service';
import {
  COOKIE_POLICIES,
  normalizeCookiePolicy,
  parseJavaScriptExceptions,
  serializeJavaScriptExceptions,
  type CookiePolicy,
} from '@/browser/privacy/privacy-settings';
import { announceProfileMessage } from '@/browser/profiles/profile-feedback';
import { useTheme } from '@/hooks/use-theme';
import { useTranslation, type TranslationKey } from '@/localization';
import { useSettingsStore } from '@/store/settings';
import { useTourBlocker } from '@/tour/tour-store';

import { SettingsRow, SettingsSection } from '../components';
import { ChoiceSheet, type ChoiceOption } from './ChoiceSheet';

const COOKIE_LABELS: Record<CookiePolicy, { label: TranslationKey; hint: TranslationKey }> = {
  'allow-all': { label: 'browserPrivacy.cookiesAllowAll', hint: 'browserPrivacy.cookiesAllowAllHint' },
  'block-third-party': { label: 'browserPrivacy.cookiesBlockThirdParty', hint: 'browserPrivacy.cookiesBlockThirdPartyHint' },
  'block-all': { label: 'browserPrivacy.cookiesBlockAll', hint: 'browserPrivacy.cookiesBlockAllHint' },
};

function useSizeLabel() {
  const { t } = useTranslation();
  return useCallback(
    (bytes: number) => {
      const size = formatStorageSize(bytes);
      return size.unit === 'mb' ? t('browserPrivacy.sizeMb', { size: size.size }) : t('browserPrivacy.sizeKb', { size: size.size });
    },
    [t],
  );
}

/** A bottom sheet for the site lists below (keeps the section file self-contained, like ChoiceSheet). */
const ListSheet = memo(function ListSheet({
  visible,
  title,
  onClose,
  children,
  testID,
}: {
  visible: boolean;
  title: string;
  onClose: () => void;
  children: React.ReactNode;
  testID: string;
}) {
  const theme = useTheme();
  const insets = useSafeAreaInsets();
  const { t } = useTranslation();
  useTourBlocker(visible);
  if (!visible) return null;
  return (
    <Modal visible transparent animationType="fade" onRequestClose={onClose} statusBarTranslucent>
      <View style={styles.root}>
        <RNPressable
          accessibilityRole="button"
          accessibilityLabel={t('common.dismiss')}
          onPress={onClose}
          style={[StyleSheet.absoluteFill, { backgroundColor: `rgba(0,0,0,${theme.opacity.overlay})` }]}
        />
        <View
          testID={testID}
          style={{
            backgroundColor: theme.colors.card,
            borderTopLeftRadius: theme.radius.xl,
            borderTopRightRadius: theme.radius.xl,
            paddingTop: 8,
            paddingBottom: insets.bottom + 12,
            maxHeight: '85%',
          }}>
          <View style={[styles.handle, { backgroundColor: theme.colors.border }]} />
          <ScrollView contentContainerStyle={{ paddingHorizontal: 16, gap: 8 }}>
            <Text variant="title" accessibilityRole="header">
              {title}
            </Text>
            {children}
          </ScrollView>
        </View>
      </View>
    </Modal>
  );
});

/**
 * B12 — Browser settings → Privacy and security: #112/#113 Cookies, #115 Do Not Track, #124 HTTPS-only mode,
 * #126 insecure page warning, #135 JavaScript (and the sites set otherwise), #130 Site data. Per browser profile.
 */
export const PrivacySettingsSection = memo(function PrivacySettingsSection() {
  const { t, rtl } = useTranslation();
  const theme = useTheme();
  const sizeLabel = useSizeLabel();
  const update = useSettingsStore((s) => s.updateSetting);
  const cookiePolicy = normalizeCookiePolicy(useSettingsStore((s) => s.cookiePolicy));
  const doNotTrack = useSettingsStore((s) => s.doNotTrack === true);
  const httpsOnly = useSettingsStore((s) => s.httpsOnly === true);
  // A build that can't open plain http (release) is always HTTPS-only, and no insecure page can open to warn about.
  const secureOnly = !cleartextAllowed();
  const insecureWarning = useSettingsStore((s) => s.insecurePageWarning !== false);
  const javaScript = useSettingsStore((s) => s.javaScript !== false);
  const exceptionsRaw = useSettingsStore((s) => s.javaScriptExceptions);
  const exceptions = useMemo(() => parseJavaScriptExceptions(exceptionsRaw), [exceptionsRaw]);
  const [sheet, setSheet] = useState<'cookies' | 'exceptions' | 'data' | null>(null);
  const [siteData, setSiteData] = useState<SiteDataEntry[] | null>(null);
  const [confirm, setConfirm] = useState<{ origin: string | null } | null>(null);

  const cookieOptions = useMemo(
    (): ChoiceOption<CookiePolicy>[] =>
      COOKIE_POLICIES.map((value) => ({
        value,
        label: t(COOKIE_LABELS[value].label),
        description: t(COOKIE_LABELS[value].hint),
      })),
    [t],
  );

  const openSiteData = async () => {
    setSheet('data');
    setSiteData(null);
    setSiteData(await listSiteData());
  };

  const runClear = async () => {
    const target = confirm;
    setConfirm(null);
    if (!target) return;
    if (target.origin) {
      await clearSiteDataForOrigin(target.origin);
    } else {
      await clearAllSiteData();
    }
    announceProfileMessage(t('browserPrivacy.cleared'));
    setSiteData(await listSiteDataAfterClear());
  };

  const toggle = (
    key: 'doNotTrack' | 'httpsOnly' | 'insecurePageWarning' | 'javaScript',
    value: boolean,
    title: string,
    hint: string,
    testID: string,
    disabled = false,
  ) => (
    <Switch
      value={value}
      onValueChange={(next) => update(key, next)}
      accessibilityLabel={title}
      accessibilityHint={hint}
      disabled={disabled}
      testID={testID}
    />
  );

  return (
    <SettingsSection
      testID="browser-settings-privacy"
      title={t('browserPrivacy.section')}
      description={t('browserPrivacy.sectionDescription')}
      icon="shield-lock-outline">
      <SettingsRow
        title={t('browserPrivacy.cookies')}
        description={t('browserPrivacy.cookiesHint')}
        icon="cookie-outline"
        value={t(COOKIE_LABELS[cookiePolicy].label)}
        onPress={() => setSheet('cookies')}
        testID="browser-settings-cookies"
      />
      <SettingsRow
        title={t('browserPrivacy.doNotTrack')}
        description={t('browserPrivacy.doNotTrackHint')}
        icon="eye-off-outline"
        trailing={toggle('doNotTrack', doNotTrack, t('browserPrivacy.doNotTrack'), t('browserPrivacy.doNotTrackHint'), 'browser-settings-dnt')}
      />
      <SettingsRow
        title={t('browserPrivacy.httpsOnly')}
        description={secureOnly ? t('browserPrivacy.httpsOnlyAlways') : t('browserPrivacy.httpsOnlyHint')}
        icon="lock-check-outline"
        trailing={toggle(
          'httpsOnly',
          secureOnly || httpsOnly,
          t('browserPrivacy.httpsOnly'),
          secureOnly ? t('browserPrivacy.httpsOnlyAlways') : t('browserPrivacy.httpsOnlyHint'),
          'browser-settings-https-only',
          secureOnly,
        )}
      />
      {secureOnly ? null : (
        <SettingsRow
          title={t('browserPrivacy.insecureWarning')}
          description={t('browserPrivacy.insecureWarningHint')}
          icon="alert-outline"
          trailing={toggle(
            'insecurePageWarning',
            insecureWarning,
            t('browserPrivacy.insecureWarning'),
            t('browserPrivacy.insecureWarningHint'),
            'browser-settings-insecure-warning',
          )}
        />
      )}
      <SettingsRow
        title={t('browserPrivacy.javaScript')}
        description={t('browserPrivacy.javaScriptHint')}
        icon="language-javascript"
        trailing={toggle('javaScript', javaScript, t('browserPrivacy.javaScript'), t('browserPrivacy.javaScriptHint'), 'browser-settings-javascript')}
      />
      <SettingsRow
        title={t('browserPrivacy.jsExceptions')}
        description={
          exceptions.length > 0
            ? t('browserPrivacy.jsExceptionsCount', { count: exceptions.length })
            : t('browserPrivacy.jsExceptionsNone')
        }
        icon="format-list-bulleted"
        onPress={exceptions.length > 0 ? () => setSheet('exceptions') : undefined}
        testID="browser-settings-js-exceptions"
      />
      <SettingsRow
        title={t('browserPrivacy.siteData')}
        description={t('browserPrivacy.siteDataHint')}
        icon="database-outline"
        showDivider={false}
        onPress={() => void openSiteData()}
        testID="browser-settings-site-data"
      />

      <ChoiceSheet
        visible={sheet === 'cookies'}
        title={t('browserPrivacy.cookies')}
        options={cookieOptions}
        value={cookiePolicy}
        onSelect={(next) => update('cookiePolicy', next)}
        onClose={() => setSheet(null)}
        testID="browser-settings-cookies-sheet"
      />

      <ListSheet
        visible={sheet === 'exceptions'}
        title={t('browserPrivacy.jsExceptions')}
        onClose={() => setSheet(null)}
        testID="browser-settings-js-exceptions-sheet">
        {exceptions.map((site, index) => (
          <View key={site}>
            {index > 0 ? <Divider /> : null}
            <Box row rtlRow center gap={12} style={{ minHeight: 56 }}>
              <Box flex={1} style={{ minWidth: 0 }}>
                <Text variant="body" numberOfLines={1} style={{ textAlign: rtl.textAlign }}>
                  {site}
                </Text>
                <Text variant="caption" color="textSecondary" style={{ textAlign: rtl.textAlign }}>
                  {javaScript ? t('browserPrivacy.jsExceptionOff') : t('browserPrivacy.jsExceptionOn')}
                </Text>
              </Box>
              <Pressable
                accessibilityRole="button"
                accessibilityLabel={t('browserPrivacy.removeExceptionA11y', { site })}
                onPress={() =>
                  update('javaScriptExceptions', serializeJavaScriptExceptions(exceptions.filter((host) => host !== site)))
                }
                style={styles.icon}>
                <Icon name="close" size={20} color="secondary" />
              </Pressable>
            </Box>
          </View>
        ))}
      </ListSheet>

      <ListSheet
        visible={sheet === 'data'}
        title={t('browserPrivacy.siteData')}
        onClose={() => setSheet(null)}
        testID="browser-settings-site-data-sheet">
        <Text variant="caption" color="textSecondary" style={{ textAlign: rtl.textAlign }}>
          {t('browserPrivacy.siteDataCookiesNote')}
        </Text>
        {siteData == null ? (
          <Box row rtlRow center gap={8} style={{ minHeight: 48 }}>
            <ActivityIndicator size="small" color={theme.colors.primary} />
            <Text variant="caption" color="textSecondary">
              {t('browserPrivacy.siteDataLoading')}
            </Text>
          </Box>
        ) : siteData.length === 0 ? (
          <Text variant="body" color="textSecondary" style={{ textAlign: rtl.textAlign }}>
            {t('browserPrivacy.siteDataEmpty')}
          </Text>
        ) : (
          siteData.map((entry, index) => (
            <View key={entry.origin}>
              {index > 0 ? <Divider /> : null}
              <Box row rtlRow center gap={12} style={{ minHeight: 56 }}>
                <Box flex={1} style={{ minWidth: 0 }}>
                  <Text variant="body" numberOfLines={1} style={{ textAlign: rtl.textAlign }}>
                    {entry.origin.replace(/^https?:\/\//, '')}
                  </Text>
                  <Text variant="caption" color="textSecondary" style={{ textAlign: rtl.textAlign }}>
                    {sizeLabel(entry.usage)}
                  </Text>
                </Box>
                <Pressable
                  accessibilityRole="button"
                  accessibilityLabel={t('browserPrivacy.clearSiteA11y', { site: entry.origin.replace(/^https?:\/\//, '') })}
                  onPress={() => setConfirm({ origin: entry.origin })}
                  style={styles.textButton}>
                  <Text variant="button" color="error">
                    {t('browserPrivacy.clearSite')}
                  </Text>
                </Pressable>
              </Box>
            </View>
          ))
        )}
        <Pressable
          accessibilityRole="button"
          accessibilityLabel={t('browserPrivacy.clearAll')}
          onPress={() => setConfirm({ origin: null })}
          testID="browser-settings-clear-all-site-data"
          style={[styles.wide, { borderColor: theme.colors.error, borderRadius: theme.radius.lg }]}>
          <Icon name="delete-outline" size={20} color="error" />
          <Text variant="button" color="error">
            {t('browserPrivacy.clearAll')}
          </Text>
        </Pressable>
        <ConfirmModal
          visible={confirm != null}
          variant="delete"
          title={
            confirm?.origin
              ? t('browserPrivacy.clearSiteTitle', { site: confirm.origin.replace(/^https?:\/\//, '') })
              : t('browserPrivacy.clearAllTitle')
          }
          message={confirm?.origin ? t('browserPrivacy.clearSiteMessage') : t('browserPrivacy.clearAllMessage')}
          confirmLabel={confirm?.origin ? t('browserPrivacy.clearSite') : t('browserPrivacy.clearAll')}
          cancelLabel={t('common.cancel')}
          onConfirm={() => void runClear()}
          onCancel={() => setConfirm(null)}
          testID="browser-settings-site-data-confirm"
        />
      </ListSheet>
    </SettingsSection>
  );
});

const styles = StyleSheet.create({
  root: { flex: 1, justifyContent: 'flex-end' },
  handle: { alignSelf: 'center', width: 40, height: 4, borderRadius: 2, marginBottom: 12 },
  icon: { width: 48, height: 48, alignItems: 'center', justifyContent: 'center' },
  textButton: { minHeight: 48, minWidth: 64, paddingHorizontal: 12, alignItems: 'center', justifyContent: 'center' },
  wide: {
    minHeight: 48,
    marginTop: 8,
    borderWidth: 1,
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    gap: 8,
  },
});
