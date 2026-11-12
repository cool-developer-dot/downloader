import { memo } from 'react';
import { RefreshControl, ScrollView, type ViewStyle } from 'react-native';

import { Box } from '@/components/base/Box';
import { Icon } from '@/components/base/Icon';
import { Text } from '@/components/base/Text';
import { Button } from '@/components/buttons/Button';
import { EmptyState } from '@/components/common/EmptyState';
import { useTheme } from '@/hooks/use-theme';
import { useTranslation } from '@/localization';
import { useDownloadsTokens } from '../theme/downloads-tokens';

export type DownloadEmptyStateProps = {
  variant?: 'default' | 'search' | 'filter' | 'completed';
  onActionPress?: () => void;
  refreshing?: boolean;
  onRefresh?: () => void;
  testID?: string;
};

const DESCRIPTION_MAX_WIDTH = 300;
const CTA_MIN_WIDTH = 168;

export const DownloadEmptyState = memo(function DownloadEmptyState({
  variant = 'default',
  onActionPress,
  refreshing = false,
  onRefresh,
  testID = 'downloads-empty-state',
}: DownloadEmptyStateProps) {
  const downloadsTokens = useDownloadsTokens();
  const theme = useTheme();
  const { t } = useTranslation();

  let content = (
    <Box
      testID={testID}
      center
      px={24}
      style={
        {
          maxWidth: 360,
          width: '100%',
          alignSelf: 'center',
        } as ViewStyle
      }>
      <Icon name="download-outline" size={downloadsTokens.emptyIconSize} color="default" />

      <Box center gap={10} mt={20} style={{ maxWidth: DESCRIPTION_MAX_WIDTH, width: '100%' }}>
        <Text
          variant="title"
          color="textPrimary"
          align="center"
          accessibilityRole="header">
          {t('downloads.emptyTitle')}
        </Text>
        <Text
          variant="body"
          color="textSecondary"
          align="center"
          style={{ maxWidth: DESCRIPTION_MAX_WIDTH }}>
          {t('downloads.emptyDescription')}
        </Text>
      </Box>

      {onActionPress ? (
        <Box mt={28} style={{ minWidth: CTA_MIN_WIDTH, alignSelf: 'center' }}>
          <Button
            title={t('downloads.emptyAction')}
            onPress={onActionPress}
            variant="primary"
            size="medium"
            fullWidth
            accessibilityLabel={t('downloads.emptyAction')}
            accessibilityHint={t('downloads.emptyActionHint')}
            testID="downloads-empty-paste-link-button"
          />
        </Box>
      ) : null}
    </Box>
  );

  if (variant === 'search') {
    content = (
      <EmptyState
        icon="magnify"
        title={t('downloads.emptySearchTitle')}
        description={t('downloads.emptySearchDescription')}
        testID={testID}
      />
    );
  } else if (variant === 'filter') {
    content = (
      <EmptyState
        icon="filter-outline"
        title={t('downloads.emptyFilterTitle')}
        description={t('downloads.emptyFilterDescription')}
        testID={testID}
      />
    );
  } else if (variant === 'completed') {
    content = (
      <EmptyState
        icon="check-circle-outline"
        title={t('downloads.emptyCompletedTitle')}
        description={t('downloads.emptyCompletedDescription')}
        testID={testID}
      />
    );
  }

  return (
    <ScrollView
      style={{ flex: 1 }}
      contentContainerStyle={{ flexGrow: 1, justifyContent: 'center' }}
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
      <Box flex={1} center px={16} py={32}>
        {content}
      </Box>
    </ScrollView>
  );
});
