import { Image } from 'expo-image';
import { memo } from 'react';
import { View } from 'react-native';

import { Box } from '@/components/base/Box';
import { Text } from '@/components/base/Text';
import { getAppIdentityMetadata } from '@/constants/app-identity';
import { useTheme } from '@/hooks/use-theme';
import { useTranslation } from '@/localization';

import { ABOUT_LAYOUT, ABOUT_LOGO } from './about.constants';

/**
 * Premium product identity header — logo, brand, tagline, version/build.
 * Logo is not mirrored in RTL.
 */
export const AboutIdentityHeader = memo(function AboutIdentityHeader() {
  const theme = useTheme();
  const { t } = useTranslation();
  const meta = getAppIdentityMetadata();

  return (
    <View
      testID="about-identity"
      style={[
        {
          backgroundColor: theme.colors.card,
          borderRadius: theme.radius.xl,
          borderWidth: 1,
          borderColor: theme.colors.border,
          paddingVertical: 28,
          paddingHorizontal: 20,
          alignItems: 'center',
        },
        theme.elevation.sm,
      ]}
      accessible
      accessibilityRole="summary"
      accessibilityLabel={t('about.identityA11y', {
        version: meta.version,
        build: meta.build,
      })}>
      <Image
        source={ABOUT_LOGO}
        style={{ width: ABOUT_LAYOUT.logoSize, height: ABOUT_LAYOUT.logoSize }}
        contentFit="contain"
        accessibilityLabel={t('about.logoA11y')}
        accessibilityRole="image"
      />

      <Box gap={ABOUT_LAYOUT.identityGap} mt={16} style={{ alignItems: 'center' }}>
        <Text
          variant="title"
          accessibilityRole="header"
          style={{
            letterSpacing: -0.4,
            color: theme.colors.textPrimary,
            textAlign: 'center',
          }}>
          {meta.appName}
        </Text>
        <Text
          variant="body"
          style={{
            color: theme.colors.textSecondary,
            textAlign: 'center',
            lineHeight: 22,
          }}>
          {t('about.tagline')}
        </Text>
        <Text
          variant="bodySmall"
          style={{
            color: theme.colors.textDisabled,
            textAlign: 'center',
            // Version/build stay LTR — do not mirror numeric metadata.
            writingDirection: 'ltr',
          }}>
          {t('about.versionBuildLabel', {
            version: meta.version,
            build: meta.build,
          })}
        </Text>
      </Box>
    </View>
  );
});
