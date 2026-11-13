import { memo, useEffect, useSyncExternalStore } from 'react';
import { AccessibilityInfo, View } from 'react-native';
import Animated, { FadeInDown, FadeOutDown } from 'react-native-reanimated';

import { Pressable } from '@/components/base/Pressable';
import { Text } from '@/components/base/Text';
import { useTheme } from '@/hooks/use-theme';
import { useTranslation, type TranslationKey } from '@/localization';

import type { SitePermissionKind } from '../site-permissions';
import { siteNotice, sitePermissionActions, sitePermissionsSheet } from '../site-permissions.service';

const PERMISSION_MESSAGES: Record<SitePermissionKind, TranslationKey> = {
  location: 'browserSitePermissions.blockedLocation',
  camera: 'browserSitePermissions.blockedCamera',
  microphone: 'browserSitePermissions.blockedMicrophone',
  notifications: 'browserSitePermissions.blockedNotifications',
};

const PERMISSION_MS = 5_000;
const POPUP_MS = 8_000;

const BarButton = memo(function BarButton({
  label,
  onPress,
  testID,
}: {
  label: string;
  onPress: () => void;
  testID?: string;
}) {
  const theme = useTheme();
  return (
    <Pressable
      testID={testID}
      accessibilityRole="button"
      accessibilityLabel={label}
      onPress={onPress}
      style={{ minHeight: 48, minWidth: 48, paddingHorizontal: 10, alignItems: 'center', justifyContent: 'center' }}>
      <Text variant="button" style={{ color: theme.colors.background }}>
        {label}
      </Text>
    </Pressable>
  );
});

/**
 * B13 — the short bar over the page: "VidoraX blocked <site> from using your location" (· Site settings), or "Pop-up
 * blocked" with Allow once / Always for this site. A live region; it goes after a few seconds (longer if Android's
 * "Time to take action" asks for it).
 */
export const SiteNoticeBar = memo(function SiteNoticeBar({ visible, bottom = 12 }: { visible: boolean; bottom?: number }) {
  const theme = useTheme();
  const { t, rtl } = useTranslation();
  const notice = useSyncExternalStore(siteNotice.subscribe, siteNotice.get, siteNotice.get);

  useEffect(() => {
    if (!notice) return undefined;
    let cancelled = false;
    let timer: ReturnType<typeof setTimeout> | null = null;
    const base = notice.kind === 'popup' ? POPUP_MS : PERMISSION_MS;
    void AccessibilityInfo.getRecommendedTimeoutMillis(base)
      .catch(() => base)
      .then((ms) => {
        if (cancelled) return;
        timer = setTimeout(() => siteNotice.dismiss(notice.shownAt), Math.max(base, ms));
      });
    return () => {
      cancelled = true;
      if (timer) clearTimeout(timer);
    };
  }, [notice]);

  if (!notice || !visible) return null;

  const message =
    notice.kind === 'permission'
      ? t(PERMISSION_MESSAGES[notice.permission], { site: notice.site })
      : t('browserSitePermissions.popupBlocked');

  return (
    <Animated.View
      entering={FadeInDown.duration(160)}
      exiting={FadeOutDown.duration(160)}
      pointerEvents="box-none"
      style={{ position: 'absolute', left: 12, right: 12, bottom, zIndex: 55, elevation: 7 }}>
      <View
        testID="site-notice-bar"
        accessibilityLiveRegion="polite"
        style={{
          borderRadius: theme.radius.md,
          backgroundColor: theme.colors.textPrimary,
          paddingHorizontal: 16,
          paddingVertical: 6,
        }}>
        <Text
          variant="body"
          style={{ color: theme.colors.background, paddingVertical: 6 }}
          accessibilityLabel={notice.kind === 'popup' ? t('browserSitePermissions.popupBlockedA11y', { site: notice.site }) : message}>
          {message}
        </Text>
        <View style={{ flexDirection: rtl.rowDirection, flexWrap: 'wrap', justifyContent: 'flex-end' }}>
          {notice.kind === 'popup' ? (
            <>
              {notice.url ? (
                <BarButton
                  label={t('browserSitePermissions.allowOnce')}
                  onPress={() => sitePermissionActions.allowPopupOnce(notice)}
                  testID="site-notice-allow-once"
                />
              ) : null}
              <BarButton
                label={t('browserSitePermissions.allowAlways')}
                onPress={() => sitePermissionActions.allowPopupsAlways(notice)}
                testID="site-notice-allow-always"
              />
            </>
          ) : (
            <BarButton
              label={t('browserSitePermissions.siteSettings')}
              onPress={() => {
                siteNotice.dismiss(notice.shownAt);
                sitePermissionsSheet.open(notice.site);
              }}
              testID="site-notice-settings"
            />
          )}
          <BarButton
            label={t('browserSitePermissions.dismiss')}
            onPress={() => siteNotice.dismiss(notice.shownAt)}
            testID="site-notice-dismiss"
          />
        </View>
      </View>
    </Animated.View>
  );
});
