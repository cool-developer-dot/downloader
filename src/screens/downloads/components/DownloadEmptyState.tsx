import { memo } from 'react';
import { RefreshControl, ScrollView, View } from 'react-native';

import { ds, DsButton, DsIcon, DsText, type DsIconName } from '@/design';
import { useTheme } from '@/hooks/use-theme';
import { useTranslation, type TranslationKey } from '@/localization';

export type DownloadEmptyStateProps = {
  variant?: 'default' | 'search' | 'filter' | 'completed';
  onActionPress?: () => void;
  refreshing?: boolean;
  onRefresh?: () => void;
  testID?: string;
};

const DESCRIPTION_MAX_WIDTH = 300;

const VARIANTS: Record<
  NonNullable<DownloadEmptyStateProps['variant']>,
  { icon: DsIconName; title: TranslationKey; description: TranslationKey }
> = {
  default: { icon: 'download', title: 'downloads.emptyTitle', description: 'downloads.emptyDescription' },
  search: { icon: 'search', title: 'downloads.emptySearchTitle', description: 'downloads.emptySearchDescription' },
  filter: { icon: 'sliders-horizontal', title: 'downloads.emptyFilterTitle', description: 'downloads.emptyFilterDescription' },
  completed: { icon: 'circle-check', title: 'downloads.emptyCompletedTitle', description: 'downloads.emptyCompletedDescription' },
};

export const DownloadEmptyState = memo(function DownloadEmptyState({
  variant = 'default',
  onActionPress,
  refreshing = false,
  onRefresh,
  testID = 'downloads-empty-state',
}: DownloadEmptyStateProps) {
  const theme = useTheme();
  const { t } = useTranslation();
  const copy = VARIANTS[variant];

  return (
    <ScrollView
      style={{ flex: 1 }}
      contentContainerStyle={{ flexGrow: 1, justifyContent: 'center', paddingHorizontal: ds.space.screenX }}
      keyboardShouldPersistTaps="handled"
      refreshControl={
        onRefresh ? (
          <RefreshControl
            refreshing={refreshing}
            onRefresh={onRefresh}
            tintColor={theme.colors.primary}
            colors={[theme.colors.primary]}
            accessibilityLabel={t('downloads.refreshListA11y')}
          />
        ) : undefined
      }>
      <View testID={testID} style={{ alignItems: 'center', paddingVertical: 32, gap: 10 }}>
        <View
          style={{
            width: 56,
            height: 56,
            borderRadius: 16,
            backgroundColor: theme.colors.accentSoft,
            alignItems: 'center',
            justifyContent: 'center',
          }}>
          <DsIcon name={copy.icon} size={26} color="primary" strokeWidth={1.8} />
        </View>
        <DsText variant="cardTitle" align="center" accessibilityRole="header" style={{ marginTop: 6 }}>
          {t(copy.title)}
        </DsText>
        <DsText variant="body" align="center" style={{ maxWidth: DESCRIPTION_MAX_WIDTH }}>
          {t(copy.description)}
        </DsText>
        {variant === 'default' && onActionPress ? (
          <DsButton
            label={t('downloads.emptyAction')}
            variant="primary"
            icon="globe"
            onPress={onActionPress}
            accessibilityHint={t('downloads.emptyActionHint')}
            style={{ marginTop: 14, minWidth: 168 }}
            testID="downloads-empty-paste-link-button"
          />
        ) : null}
      </View>
    </ScrollView>
  );
});
