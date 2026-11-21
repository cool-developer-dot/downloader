import { memo } from 'react';
import { View } from 'react-native';

import { ds, DsButton, DsIcon, DsText } from '@/design';
import { useTheme } from '@/hooks/use-theme';
import { useTranslation } from '@/localization';

export type FavoriteEmptyStateProps = {
  variant?: 'default' | 'search';
  onActionPress?: () => void;
  testID?: string;
};

export const FavoriteEmptyState = memo(function FavoriteEmptyState({
  variant = 'default',
  onActionPress,
  testID = 'favorites-empty-state',
}: FavoriteEmptyStateProps) {
  const theme = useTheme();
  const { t } = useTranslation();
  const search = variant === 'search';

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
          <DsIcon name={search ? 'search' : 'heart'} size={26} color="primary" strokeWidth={1.8} />
        </View>
        <DsText variant="cardTitle" align="center" accessibilityRole="header" style={{ marginTop: 6 }}>
          {search ? t('favorites.emptySearchTitle') : t('favorites.emptyTitle')}
        </DsText>
        <DsText variant="body" align="center" style={{ maxWidth: 300 }}>
          {search ? t('favorites.emptySearchDescription') : t('favorites.emptyDescription')}
        </DsText>
        {!search && onActionPress ? (
          <DsButton
            label={t('favorites.emptyAction')}
            variant="primary"
            icon="download"
            onPress={onActionPress}
            style={{ marginTop: 14, minWidth: 168 }}
            testID={`${testID}-action`}
          />
        ) : null}
      </View>
    </View>
  );
});
