import { memo } from 'react';
import { View } from 'react-native';

import { Icon } from '@/components/base/Icon';
import { Pressable } from '@/components/base/Pressable';
import { Text } from '@/components/base/Text';
import { useTheme } from '@/hooks/use-theme';
import { useTranslation } from '@/localization';

import { OPEN_IN_APP_NAMES } from '../open-in-app';
import { dismissOpenInApp, neverAskForOfferSite, openOfferInApp, useOpenInAppOffer } from '../open-in-app.service';

/** B22 #273 — a small chip over the page: "Open in <app>", "Don't ask for this site", close. */
export const OpenInAppChip = memo(function OpenInAppChip({ visible, bottom }: { visible: boolean; bottom: number }) {
  const theme = useTheme();
  const { t, rtl } = useTranslation();
  const offer = useOpenInAppOffer();
  if (!visible || !offer) return null;
  const app = OPEN_IN_APP_NAMES[offer.app];
  return (
    <View
      testID="browser-open-in-app"
      accessibilityLiveRegion="polite"
      style={{
        position: 'absolute',
        left: 12,
        right: 12,
        bottom,
        zIndex: 40,
        flexDirection: rtl.rowDirection,
        alignItems: 'center',
        flexWrap: 'wrap',
        gap: 4,
        paddingHorizontal: 8,
        borderRadius: theme.radius.lg,
        backgroundColor: theme.colors.card,
        borderWidth: 1,
        borderColor: theme.colors.border,
      }}>
      <Pressable
        accessibilityRole="button"
        accessibilityLabel={t('browserShare.openInAppA11y', { app })}
        onPress={() => void openOfferInApp()}
        testID="browser-open-in-app-open"
        style={{ minHeight: 48, flexDirection: rtl.rowDirection, alignItems: 'center', gap: 6, paddingHorizontal: 6 }}>
        <Icon name="open-in-app" size={20} color="primary" />
        <Text variant="label" color="primary">
          {t('browserShare.openInApp', { app })}
        </Text>
      </Pressable>
      <Pressable
        accessibilityRole="button"
        accessibilityLabel={t('browserShare.openInAppNever')}
        onPress={neverAskForOfferSite}
        testID="browser-open-in-app-never"
        style={{ minHeight: 48, justifyContent: 'center', paddingHorizontal: 6, flex: 1 }}>
        <Text variant="caption" color="textSecondary" style={{ textAlign: rtl.textAlign }}>
          {t('browserShare.openInAppNever')}
        </Text>
      </Pressable>
      <Pressable
        accessibilityRole="button"
        accessibilityLabel={t('browserShare.openInAppDismissA11y')}
        onPress={dismissOpenInApp}
        testID="browser-open-in-app-close"
        style={{ minHeight: 48, minWidth: 48, alignItems: 'center', justifyContent: 'center' }}>
        <Icon name="close" size={20} color="secondary" />
      </Pressable>
    </View>
  );
});
