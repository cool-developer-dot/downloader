import { memo, useCallback } from 'react';
import { type StyleProp, type ViewStyle } from 'react-native';

import { Box } from '@/components/base/Box';
import { IconButton } from '@/components/buttons/IconButton';
import { SearchField } from '@/components/inputs/SearchField';
import { useTheme } from '@/hooks/use-theme';
import { useTranslation } from '@/localization';

export type SearchHeaderProps = {
  value: string;
  onChangeText: (value: string) => void;
  onSearch?: (value: string) => void;
  placeholder?: string;
  showBack?: boolean;
  onBackPress?: () => void;
  style?: StyleProp<ViewStyle>;
  testID?: string;
};

export const SearchHeader = memo(function SearchHeader({
  value,
  onChangeText,
  onSearch,
  placeholder,
  showBack = false,
  onBackPress,
  style,
  testID,
}: SearchHeaderProps) {
  const theme = useTheme();
  const { t, rtl } = useTranslation();
  const resolvedPlaceholder = placeholder ?? t('common.search');

  const handleSearch = useCallback(
    (query: string) => {
      onSearch?.(query);
    },
    [onSearch],
  );

  return (
    <Box
      testID={testID}
      row
      rtlRow
      center
      px={16}
      py={12}
      gap={12}
      backgroundColor="background"
      style={[ { borderBottomWidth: 1, borderBottomColor: theme.colors.divider }, style]}>
      {showBack ? (
        <IconButton
          icon={rtl.arrowBack}
          accessibilityLabel={t('common.goBack')}
          onPress={onBackPress}
          variant="ghost"
        />
      ) : null}
      <Box flex={1}>
        <SearchField
          value={value}
          onChangeText={onChangeText}
          onSearch={handleSearch}
          placeholder={resolvedPlaceholder}
        />
      </Box>
    </Box>
  );
});
