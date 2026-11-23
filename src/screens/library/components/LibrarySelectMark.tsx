import { memo } from 'react';
import { View } from 'react-native';

import { Icon } from '@/components/base/Icon';
import { useTheme } from '@/hooks/use-theme';

/**
 * P7: the Library's selection mode — a round mark over a video's thumbnail (filled ✓ when selected). Drawn over the
 * picture, so a row keeps its fixed height (`LibraryList`'s getItemLayout).
 */
export const LibrarySelectMark = memo(function LibrarySelectMark({ selected }: { selected: boolean }) {
  const theme = useTheme();
  return (
    <View
      pointerEvents="none"
      importantForAccessibility="no-hide-descendants"
      style={{
        position: 'absolute',
        top: 4,
        start: 4,
        borderRadius: 12,
        backgroundColor: theme.colors.card,
      }}>
      <Icon name={selected ? 'check-circle' : 'checkbox-blank-circle-outline'} size={22} color={selected ? 'primary' : 'secondary'} />
    </View>
  );
});
