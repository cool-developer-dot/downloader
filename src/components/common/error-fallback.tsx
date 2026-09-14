import { StyleSheet, View } from 'react-native';
import { Button, Text } from 'react-native-paper';

import { useTheme } from '@/hooks/use-theme';
import { useTranslation } from '@/localization';
import { spacing, typography } from '@/theme';

type ErrorFallbackProps = {
  error: Error;
  resetError: () => void;
};

export function ErrorFallback({ error: _error, resetError }: ErrorFallbackProps) {
  const theme = useTheme();
  const { t } = useTranslation();

  return (
    <View style={[styles.container, { backgroundColor: theme.colors.background }]}>
      <Text style={[typography.h3, { color: theme.colors.textPrimary }]}>
        {t('errors.unexpectedTitle')}
      </Text>
      <Text style={[typography.bodySmall, styles.message, { color: theme.colors.textSecondary }]}>
        {t('errors.unexpected')}
      </Text>
      <Button mode="contained" onPress={resetError}>
        {t('common.retry')}
      </Button>
    </View>
  );
}

const styles = StyleSheet.create({
  container: {
    flex: 1,
    justifyContent: 'center',
    alignItems: 'center',
    padding: spacing[24],
    gap: spacing[16],
  },
  message: {
    textAlign: 'center',
  },
});
