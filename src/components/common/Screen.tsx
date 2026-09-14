import { memo, type PropsWithChildren } from 'react';
import {
  RefreshControl,
  ScrollView,
  type ScrollViewProps,
  type StyleProp,
  type ViewStyle,
} from 'react-native';

import { Box } from '@/components/base/Box';
import { useTheme } from '@/hooks/use-theme';
import { useTranslation } from '@/localization';

export type ScreenProps = PropsWithChildren<{
  scrollable?: boolean;
  padded?: boolean;
  refreshing?: boolean;
  onRefresh?: () => void;
  style?: StyleProp<ViewStyle>;
  contentContainerStyle?: ScrollViewProps['contentContainerStyle'];
  testID?: string;
}>;

export const Screen = memo(function Screen({
  children,
  scrollable = false,
  padded = true,
  refreshing = false,
  onRefresh,
  style,
  contentContainerStyle,
  testID,
}: ScreenProps) {
  const theme = useTheme();
  const { t } = useTranslation();

  if (scrollable) {
    return (
      <ScrollView
        testID={testID}
        style={[{ flex: 1, backgroundColor: theme.colors.background }, style]}
        contentContainerStyle={[
          padded ? { padding: theme.spacing[16] } : undefined,
          contentContainerStyle,
        ]}
        keyboardShouldPersistTaps="handled"
        refreshControl={
          onRefresh ? (
            <RefreshControl
              refreshing={refreshing}
              onRefresh={onRefresh}
              tintColor={theme.colors.primary}
              colors={[theme.colors.primary]}
              accessibilityLabel={t('common.refreshA11y')}
            />
          ) : undefined
        }>
        {children}
      </ScrollView>
    );
  }

  return (
    <Box
      testID={testID}
      flex={1}
      p={padded ? 16 : undefined}
      backgroundColor="background"
      style={style as ViewStyle | undefined}>
      {children}
    </Box>
  );
});
