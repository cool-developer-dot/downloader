import { memo } from 'react';
import { RefreshControl, ScrollView, type ViewStyle } from 'react-native';

import { Box } from '@/components/base/Box';
import { Icon } from '@/components/base/Icon';
import { Text } from '@/components/base/Text';
import { Button } from '@/components/buttons/Button';
import { EmptyState } from '@/components/common/EmptyState';
import { useTheme } from '@/hooks/use-theme';
import { useTranslation } from '@/localization';
import { useLibraryTokens } from '../theme/library-tokens';

export type LibraryEmptyStateProps = {
  variant?: 'default' | 'search' | 'filter';
  onActionPress?: () => void;
  refreshing?: boolean;
  onRefresh?: () => void;
  testID?: string;
};

const DESCRIPTION_MAX_WIDTH = 300;
const CTA_MIN_WIDTH = 168;

export const LibraryEmptyState = memo(function LibraryEmptyState({
  variant = 'default',
  onActionPress,
  refreshing = false,
  onRefresh,
  testID = 'library-empty-state',
}: LibraryEmptyStateProps) {
  const libraryTokens = useLibraryTokens();
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
      <Icon name="play-box-multiple-outline" size={libraryTokens.emptyIconSize} color="default" />
      <Box center gap={10} mt={20} style={{ maxWidth: DESCRIPTION_MAX_WIDTH, width: '100%' }}>
        <Text variant="title" color="textPrimary" align="center" accessibilityRole="header">
          {t('library.emptyTitle')}
        </Text>
        <Text
          variant="body"
          color="textSecondary"
          align="center"
          style={{ maxWidth: DESCRIPTION_MAX_WIDTH }}>
          {t('library.emptyDescription')}
        </Text>
      </Box>
      {onActionPress ? (
        <Box mt={28} style={{ minWidth: CTA_MIN_WIDTH, alignSelf: 'center' }}>
          <Button
            title={t('library.emptyAction')}
            onPress={onActionPress}
            variant="primary"
            size="medium"
            fullWidth
            accessibilityLabel={t('library.emptyAction')}
            testID="library-empty-downloads-button"
          />
        </Box>
      ) : null}
    </Box>
  );

  if (variant === 'search') {
    content = (
      <EmptyState
        icon="magnify"
        title={t('library.emptySearchTitle')}
        description={t('library.emptySearchDescription')}
        testID={testID}
      />
    );
  } else if (variant === 'filter') {
    content = (
      <EmptyState
        icon="filter-outline"
        title={t('library.emptyFilterTitle')}
        description={t('library.emptyFilterDescription')}
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
            accessibilityLabel={t('library.refreshListA11y')}
          />
        ) : undefined
      }>
      <Box flex={1} center px={16} py={32}>
        {content}
      </Box>
    </ScrollView>
  );
});
