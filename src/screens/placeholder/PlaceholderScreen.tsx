import { useRouter } from 'expo-router';
import { memo, useCallback } from 'react';

import { Box } from '@/components/base/Box';
import { Icon, type IconName } from '@/components/base/Icon';
import { Text } from '@/components/base/Text';
import { Button } from '@/components/buttons/Button';
import { SafeAreaScreen } from '@/components/common/SafeAreaScreen';
import { Spacer } from '@/components/common/Spacer';
import { AppHeader } from '@/components/headers/AppHeader';

export type PlaceholderScreenProps = {
  title: string;
  description: string;
  icon?: IconName;
  showHeader?: boolean;
  headerTitle?: string;
  showBack?: boolean;
  onBackPress?: () => void;
  previewButtonLabel?: string;
  testID?: string;
  accessibilityLabel?: string;
};

export const PlaceholderScreen = memo(function PlaceholderScreen({
  title,
  description,
  icon,
  showHeader = false,
  headerTitle,
  showBack = false,
  onBackPress,
  previewButtonLabel,
  testID,
  accessibilityLabel,
}: PlaceholderScreenProps) {
  const router = useRouter();

  const handleBackPress = useCallback(() => {
    if (onBackPress) {
      onBackPress();
      return;
    }

    if (router.canGoBack()) {
      router.back();
    }
  }, [onBackPress, router]);

  return (
    <SafeAreaScreen testID={testID} padded={false}>
      {showHeader ? (
        <AppHeader
          title={headerTitle ?? title}
          showBack={showBack}
          onBackPress={handleBackPress}
        />
      ) : null}
      <Box flex={1} px={16}>
        <Box
          flex={1}
          center
          accessible
          accessibilityRole="summary"
          accessibilityLabel={accessibilityLabel ?? `${title}. ${description}`}>
          {icon ? (
            <Icon
              name={icon}
              size="xl"
              color="primary"
              accessibilityLabel={`${title} icon`}
            />
          ) : null}
          {icon ? <Spacer size={16} /> : null}
          <Text variant="title" align="center" accessibilityRole="header">
            {title}
          </Text>
          <Spacer size={8} />
          <Text variant="bodySmall" color="textSecondary" align="center">
            {description}
          </Text>
        </Box>
        {previewButtonLabel ? (
          <>
            <Spacer size={24} />
            <Button
              title={previewButtonLabel}
              variant="primary"
              fullWidth
              disabled
              accessibilityLabel={previewButtonLabel}
            />
          </>
        ) : null}
      </Box>
    </SafeAreaScreen>
  );
});
