import { memo } from 'react';
import { View } from 'react-native';

import { ds, DsButton, DsIcon, DsText } from '@/design';
import { useTheme } from '@/hooks/use-theme';
import { useTranslation } from '@/localization';

export type FavoriteErrorStateProps = {
  message: string;
  onRetry: () => void;
  testID?: string;
};

export const FavoriteErrorState = memo(function FavoriteErrorState({
  message,
  onRetry,
  testID = 'favorites-error-state',
}: FavoriteErrorStateProps) {
  const theme = useTheme();
  const { t } = useTranslation();
  return (
    <View style={{ flex: 1, justifyContent: 'center', paddingHorizontal: ds.space.screenX }}>
      <View testID={testID} style={{ alignItems: 'center', paddingVertical: 48, gap: 10 }}>
        <View
          style={{
            width: 56,
            height: 56,
            borderRadius: 16,
            backgroundColor: theme.colors.accentSoft,
            alignItems: 'center',
            justifyContent: 'center',
          }}>
          <DsIcon name="alert-triangle" size={26} color="primary" strokeWidth={1.8} />
        </View>
        <DsText variant="cardTitle" align="center" accessibilityRole="header" style={{ marginTop: 6 }}>
          {t('favorites.errorTitle')}
        </DsText>
        <DsText variant="body" align="center" style={{ maxWidth: 300 }}>
          {message}
        </DsText>
        <DsButton
          label={t('lightDownloads.retryLoad')}
          variant="secondary"
          icon="refresh-cw"
          onPress={onRetry}
          style={{ marginTop: 10 }}
          testID={`${testID}-retry`}
        />
      </View>
    </View>
  );
});
