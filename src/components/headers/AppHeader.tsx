import { memo, type ReactNode } from 'react';
import { type StyleProp, type ViewStyle } from 'react-native';

import { Box } from '@/components/base/Box';
import { IconButton } from '@/components/buttons/IconButton';
import { Text } from '@/components/base/Text';
import { useTheme } from '@/hooks/use-theme';
import { useTranslation } from '@/localization';

export type AppHeaderProps = {
  title: string;
  subtitle?: string;
  showBack?: boolean;
  onBackPress?: () => void;
  actions?: ReactNode;
  style?: StyleProp<ViewStyle>;
  testID?: string;
};

/**
 * App chrome header — always consumes semantic header* tokens
 * (Logo → brand red chrome; Light/Dark → neutral/dark chrome).
 */
export const AppHeader = memo(function AppHeader({
  title,
  subtitle,
  showBack = false,
  onBackPress,
  actions,
  style,
  testID,
}: AppHeaderProps) {
  const theme = useTheme();
  const { t, rtl } = useTranslation();

  return (
    <Box
      testID={testID}
      row
      rtlRow
      center
      px={16}
      py={12}
      gap={12}
      backgroundColor="headerBackground"
      style={[
        {
          borderBottomWidth: 1,
          borderBottomColor: theme.colors.headerBorder,
        },
        style,
      ]}>
      {showBack ? (
        <IconButton
          icon={rtl.arrowBack}
          accessibilityLabel={t('common.goBack')}
          onPress={onBackPress}
          variant="ghost"
          color="headerIcon"
        />
      ) : null}
      <Box flex={1} gap={2}>
        <Text
          variant="title"
          numberOfLines={1}
          style={{ color: theme.colors.headerText }}>
          {title}
        </Text>
        {subtitle ? (
          <Text
            variant="bodySmall"
            numberOfLines={1}
            style={{ color: theme.colors.headerSubtitle }}>
            {subtitle}
          </Text>
        ) : null}
      </Box>
      {actions}
    </Box>
  );
});
