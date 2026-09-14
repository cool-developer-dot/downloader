import { memo } from 'react';

import { Box } from '@/components/base/Box';
import { Text } from '@/components/base/Text';
import { getAppIdentityMetadata } from '@/constants/app-identity';
import { useTheme } from '@/hooks/use-theme';
import { useTranslation } from '@/localization';

export const AboutCopyright = memo(function AboutCopyright() {
  const theme = useTheme();
  const { t } = useTranslation();
  const { copyrightYear, appName } = getAppIdentityMetadata();

  return (
    <Box
      testID="about-copyright"
      gap={4}
      py={8}
      accessible
      accessibilityRole="text"
      accessibilityLabel={t('about.copyrightA11y', {
        year: String(copyrightYear),
        brand: appName,
      })}
      style={{ alignItems: 'center' }}>
      <Text
        variant="caption"
        style={{
          color: theme.colors.textSecondary,
          textAlign: 'center',
          writingDirection: 'ltr',
        }}>
        {t('about.copyrightLine', {
          year: String(copyrightYear),
          brand: appName,
        })}
      </Text>
      <Text
        variant="caption"
        style={{ color: theme.colors.textDisabled, textAlign: 'center' }}>
        {t('about.allRightsReserved')}
      </Text>
    </Box>
  );
});
