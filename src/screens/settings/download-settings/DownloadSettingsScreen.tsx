import { memo, useCallback, useMemo } from 'react';
import { View } from 'react-native';

import { Box } from '@/components/base/Box';
import { SafeAreaScreen } from '@/components/common/SafeAreaScreen';
import { SegmentedControl } from '@/components/inputs/SegmentedControl';
import { Switch } from '@/components/inputs/Switch';

import { useTranslation } from '@/localization';
import { selectSaveToGallery, useSettingsStore } from '@/store/settings';

import {
  SettingsFeedbackBanner,
  SettingsRow,
  SettingsSection,
  SettingsStaggerItem,
} from '../components';
import { useSettingsTokens } from '../theme/settings-tokens';
import {
  CONCURRENT_SEGMENT_OPTIONS,
} from './constants';
import { useDownloadSettingsScreen } from './useDownloadSettingsScreen';

export const DownloadSettingsScreen = memo(function DownloadSettingsScreen() {
  const settingsTokens = useSettingsTokens();
  const { t, tp } = useTranslation();
  const {
    settings,
    hydrated,
    saving,
    feedback,
    notificationEffective,
    setWifiOnly,
    setAutoResume,
    setMaxConcurrent,
    setNotifications,
    openNotificationSettings,
  } = useDownloadSettingsScreen();

  const preferenceDisabled = !hydrated;
  const saveToGallery = useSettingsStore(selectSaveToGallery);
  const concurrentValue = String(
    settings.maxConcurrentDownloads,
  ) as '1' | '2' | '3' | '4';

  const showPermissionRequired =
    settings.notificationsEnabled &&
    notificationEffective != null &&
    !notificationEffective.permissionGranted;

  const onConcurrentChange = useCallback(
    (next: '1' | '2' | '3' | '4') => {
      void setMaxConcurrent(Number(next));
    },
    [setMaxConcurrent],
  );

  const concurrentOptions = useMemo(
    () =>
      CONCURRENT_SEGMENT_OPTIONS.map((option) => ({
        ...option,
        accessibilityLabel: tp(
          Number(option.value) === 1
            ? 'plurals.simultaneousDownloadsOne'
            : 'plurals.simultaneousDownloadsOther',
          Number(option.value),
        ),
      })),
    [tp],
  );

  const concurrentA11y = useMemo(
    () =>
      `${t('settings.maxConcurrent')}, ${tp('plurals.simultaneousDownloadsOther', settings.maxConcurrentDownloads)}`,
    [settings.maxConcurrentDownloads, t, tp],
  );

  return (
    <SafeAreaScreen
      testID="download-settings-screen"
      scrollable
      padded={false}
      edges={['bottom', 'left', 'right']}
      style={{ backgroundColor: settingsTokens.background }}
      contentContainerStyle={{
        flexGrow: 1,
        paddingHorizontal: settingsTokens.spacing.screenX,
        paddingTop: settingsTokens.spacing.headerTop,
        paddingBottom: 40,
        backgroundColor: settingsTokens.background,
      }}>
      <View
        accessible={false}
        accessibilityState={{ busy: saving }}
        importantForAccessibility="yes"
        style={{ gap: settingsTokens.spacing.sectionGap }}>
        <SettingsFeedbackBanner
          visible={Boolean(feedback)}
          tone={feedback?.tone}
          title={feedback?.title ?? ''}
          message={feedback?.message ?? ''}
        />

        <SettingsStaggerItem index={0}>
          <SettingsSection
            testID="download-settings-behavior"
            title={t('settings.behaviorSection')}
            description={t('settings.behaviorDescription')}
            icon="download-outline">
            <SettingsRow
              title={t('settings.wifiOnlyLong')}
              description={t('settings.wifiOnlyLongHint')}
              icon="wifi"
              trailing={
                <Switch
                  value={settings.wifiOnly}
                  onValueChange={(value) => {
                    void setWifiOnly(value);
                  }}
                  disabled={preferenceDisabled}
                  accessibilityLabel={t('settings.wifiOnlyLong')}
                  accessibilityHint={t('settings.wifiOnlyLongHint')}
                  testID="download-settings-wifi-only-switch"
                />
              }
              accessibilityHint={t('settings.wifiOnlyLongHint')}
              testID="download-settings-wifi-only"
            />
            <SettingsRow
              title={t('settings.autoResumeLong')}
              description={t('settings.autoResumeLongHint')}
              icon="play-circle-outline"
              trailing={
                <Switch
                  value={settings.autoResume}
                  onValueChange={(value) => {
                    void setAutoResume(value);
                  }}
                  disabled={preferenceDisabled}
                  accessibilityLabel={t('settings.autoResumeLong')}
                  accessibilityHint={t('settings.autoResumeLongHint')}
                  testID="download-settings-auto-resume-switch"
                />
              }
              accessibilityHint={t('settings.autoResumeLongHint')}
              testID="download-settings-auto-resume"
            />
            <SettingsRow
              title={t('settings.saveToGallery')}
              description={t('settings.saveToGalleryHint')}
              icon="image-multiple-outline"
              trailing={
                <Switch
                  value={saveToGallery}
                  onValueChange={(value) => {
                    useSettingsStore.getState().updateSetting('saveToGallery', value);
                  }}
                  disabled={preferenceDisabled}
                  accessibilityLabel={t('settings.saveToGallery')}
                  accessibilityHint={t('settings.saveToGalleryHint')}
                  testID="download-settings-save-to-gallery-switch"
                />
              }
              showDivider={false}
              accessibilityHint={t('settings.saveToGalleryHint')}
              testID="download-settings-save-to-gallery"
            />
          </SettingsSection>
        </SettingsStaggerItem>

        <SettingsStaggerItem index={1}>
          <SettingsSection
            testID="download-settings-performance"
            title={t('settings.performanceSection')}
            description={t('settings.performanceDescription')}
            icon="flash-outline">
            <Box gap={12} py={8}>
              <SettingsRow
                title={t('settings.maxConcurrent')}
                description={t('settings.maxConcurrentHint')}
                icon="layers-outline"
                value={String(settings.maxConcurrentDownloads)}
                showDivider={false}
                accessibilityHint={t('settings.maxConcurrentHint')}
                testID="download-settings-max-concurrent"
              />
              <SegmentedControl
                options={concurrentOptions}
                value={concurrentValue}
                onChange={onConcurrentChange}
                disabled={!hydrated}
                accessibilityLabel={concurrentA11y}
                testID="download-settings-max-concurrent-control"
              />
            </Box>
          </SettingsSection>
        </SettingsStaggerItem>

        <SettingsStaggerItem index={2}>
          <SettingsSection
            testID="download-settings-notifications"
            title={t('settings.downloadNotificationsSection')}
            description={t('settings.downloadNotificationsDescription')}
            icon="bell-outline">
            <SettingsRow
              title={t('settings.downloadNotifications')}
              description={t('settings.downloadNotificationsHint')}
              icon="bell-ring-outline"
              trailing={
                <Switch
                  value={settings.notificationsEnabled}
                  onValueChange={(value) => {
                    void setNotifications(value);
                  }}
                  disabled={preferenceDisabled}
                  accessibilityLabel={t('settings.downloadNotifications')}
                  accessibilityHint={t('settings.downloadNotificationsHint')}
                  testID="download-settings-notifications-switch"
                />
              }
              showDivider={showPermissionRequired}
              accessibilityHint={t('settings.downloadNotificationsHint')}
              testID="download-settings-notifications"
            />
            {showPermissionRequired ? (
              <SettingsRow
                title={t('settings.notificationsPermissionRequired')}
                description={t('settings.notificationsPermissionHint')}
                icon="bell-off-outline"
                onPress={() => {
                  void openNotificationSettings();
                }}
                showDivider={false}
                accessibilityHint={t('settings.openSystemSettings')}
                testID="download-settings-notifications-permission"
              />
            ) : null}
          </SettingsSection>
        </SettingsStaggerItem>
      </View>
    </SafeAreaScreen>
  );
});
