import { memo } from 'react';
import { View } from 'react-native';

import { Box } from '@/components/base/Box';
import { Icon } from '@/components/base/Icon';
import { Text } from '@/components/base/Text';
import { useTheme } from '@/hooks/use-theme';
import { useTranslation } from '@/localization';
import { withAlpha } from '@/theme/colors';

export type PrivateDataLossNoticeProps = {
  /** Compact: the one-line reminder; full: title and the whole warning. */
  compact?: boolean;
  testID?: string;
};

/** Private videos live only on this phone: uninstalling VidoraX or clearing its data loses them for good. */
export const PrivateDataLossNotice = memo(function PrivateDataLossNotice({
  compact = false,
  testID = 'private-data-loss',
}: PrivateDataLossNoticeProps) {
  const theme = useTheme();
  const { t } = useTranslation();
  const warning = theme.colors.warning;
  const label = compact ? t('privateVault.dataLossCompact') : `${t('privateVault.dataLossTitle')}. ${t('privateVault.dataLossBody')}`;

  return (
    <View
      testID={testID}
      accessible
      accessibilityRole={compact ? 'text' : 'alert'}
      accessibilityLabel={label}
      style={{
        padding: compact ? 10 : 14,
        borderRadius: 12,
        borderWidth: 1,
        borderColor: withAlpha(warning, 0.45),
        backgroundColor: withAlpha(warning, 0.1),
      }}>
      <Box row rtlRow gap={10} style={{ alignItems: 'flex-start' }}>
        <Icon name="alert-outline" size={compact ? 18 : 22} color="warning" />
        <Box flex={1} gap={6}>
          {compact ? (
            <Text variant="caption" style={{ lineHeight: 18 }}>
              {t('privateVault.dataLossCompact')}
            </Text>
          ) : (
            <>
              <Text variant="button" style={{ color: warning }}>
                {t('privateVault.dataLossTitle')}
              </Text>
              <Text variant="bodySmall">{t('privateVault.dataLossBody')}</Text>
            </>
          )}
        </Box>
      </Box>
    </View>
  );
});
