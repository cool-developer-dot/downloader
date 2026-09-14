import { memo } from 'react';
import { type StyleProp, type ViewStyle } from 'react-native';

import { Box } from '@/components/base/Box';
import { Text } from '@/components/base/Text';
import { Button } from '@/components/buttons/Button';
import { useTranslation } from '@/localization';

export type ErrorStateProps = {
  title?: string;
  message: string;
  retryLabel?: string;
  onRetry?: () => void;
  style?: StyleProp<ViewStyle>;
  testID?: string;
};

export const ErrorState = memo(function ErrorState({
  title,
  message,
  retryLabel,
  onRetry,
  style,
  testID,
}: ErrorStateProps) {
  const { t } = useTranslation();
  const resolvedTitle = title ?? t('errors.unexpectedTitle');
  const resolvedRetry = retryLabel ?? t('common.retry');
  return (
    <Box testID={testID} center gap={16} p={24} style={style as ViewStyle | undefined}>
      <Box center gap={8}>
        <Text variant="title" align="center" color="error">
          {resolvedTitle}
        </Text>
        <Text variant="bodySmall" color="textSecondary" align="center">
          {message}
        </Text>
      </Box>
      {onRetry ? <Button title={resolvedRetry} onPress={onRetry} variant="outline" /> : null}
    </Box>
  );
});
