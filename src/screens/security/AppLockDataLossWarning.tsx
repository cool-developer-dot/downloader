import { memo } from 'react';
import { View } from 'react-native';

import { Icon } from '@/components/base/Icon';
import { Text } from '@/components/base/Text';
import { useTheme } from '@/hooks/use-theme';
import { useTranslation } from '@/localization';
import { withAlpha } from '@/theme/colors';

export type AppLockDataLossWarningProps = {
  /** Compact: one short paragraph (Settings); full: title, both paragraphs (setup). */
  compact?: boolean;
  testID?: string;
};

/**
 * What losing both the PIN and the recovery code means: the protected local data can't be recovered, and only a
 * reinstall (which erases the app's local data) removes the lock. Presentation only — App Lock itself is unchanged.
 */
export const AppLockDataLossWarning = memo(function AppLockDataLossWarning({
  compact = false,
  testID = 'app-lock-data-loss-warning',
}: AppLockDataLossWarningProps) {
  const theme = useTheme();
  const { t } = useTranslation();
  const warning = theme.colors.warning;

  return (
    <View
      testID={testID}
      accessible
      accessibilityRole="alert"
      accessibilityLabel={
        compact
          ? t('appLock.dataLossWarningCompact')
          : `${t('appLock.dataLossWarningTitle')}. ${t('appLock.dataLossWarningBody')} ${t('appLock.dataLossWarningReinstall')}`
      }
      style={{
        flexDirection: 'row',
        gap: 12,
        padding: compact ? 12 : 16,
        borderRadius: 12,
        borderWidth: 1,
        borderColor: withAlpha(warning, 0.45),
        backgroundColor: withAlpha(warning, 0.1),
      }}>
      <Icon name="alert-outline" size={compact ? 18 : 22} color="warning" />
      <View style={{ flex: 1, gap: 6 }}>
        {compact ? (
          <Text variant="caption" style={{ lineHeight: 18 }}>
            {t('appLock.dataLossWarningCompact')}
          </Text>
        ) : (
          <>
            <Text variant="button" style={{ color: warning, letterSpacing: 0.6 }}>
              {t('appLock.dataLossWarningTitle')}
            </Text>
            <Text variant="bodySmall">{t('appLock.dataLossWarningBody')}</Text>
            <Text variant="bodySmall" color="textSecondary">
              {t('appLock.dataLossWarningReinstall')}
            </Text>
          </>
        )}
      </View>
    </View>
  );
});
