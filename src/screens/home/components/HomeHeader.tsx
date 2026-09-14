import { memo, useCallback } from 'react';
import { Image } from 'expo-image';

import { Box } from '@/components/base/Box';
import { Text } from '@/components/base/Text';
import { IconButton } from '@/components/buttons/IconButton';
import { useTranslation } from '@/localization';
import { navigation, routePaths } from '@/navigation';
import { useHomeGreeting } from '../hooks/useHomeDashboard';
import { useHomeLayout } from '../theme/home-layout';

import { BRAND_LOGO_SIZES, VIDORAX_LOGO } from '@/constants/brand-assets';

export const HomeHeader = memo(function HomeHeader() {
  const layout = useHomeLayout();
  const greeting = useHomeGreeting();
  const { t } = useTranslation();

  const openSettings = useCallback(() => {
    navigation.navigate(routePaths.settings);
  }, []);

  return (
    <Box
      testID="home-header"
      row
      rtlRow
      center
      px={16}
      gap={12}
      backgroundColor="background"
      style={{
        paddingVertical: layout.headerY,
        borderBottomWidth: 1,
        borderBottomColor: layout.theme.colors.divider,
      }}>
      <Image
        source={VIDORAX_LOGO}
        style={{ width: BRAND_LOGO_SIZES.sm, height: BRAND_LOGO_SIZES.sm }}
        contentFit="contain"
        accessibilityElementsHidden
        importantForAccessibility="no"
      />
      <Box flex={1} gap={layout.titleGap} style={{ minWidth: 0 }}>
        <Text variant="title" numberOfLines={1} accessibilityRole="header">
          {t('home.brand')}
        </Text>
        <Text
          variant="bodySmall"
          color="textSecondary"
          numberOfLines={1}
          accessibilityLabel={greeting.headline}>
          {greeting.headline}
        </Text>
      </Box>
      <IconButton
        icon="cog-outline"
        accessibilityLabel={t('home.openSettingsA11y')}
        onPress={openSettings}
        variant="ghost"
        testID="home-settings-button"
      />
    </Box>
  );
});
