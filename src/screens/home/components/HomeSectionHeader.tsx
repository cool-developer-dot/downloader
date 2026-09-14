import { memo } from 'react';

import { Box } from '@/components/base/Box';
import { Text } from '@/components/base/Text';
import { Pressable } from '@/components/base/Pressable';

import { useHomeLayout } from '../theme/home-layout';

export type HomeSectionHeaderProps = {
  title: string;
  actionLabel?: string;
  onActionPress?: () => void;
  actionAccessibilityLabel?: string;
  testID?: string;
};

export const HomeSectionHeader = memo(function HomeSectionHeader({
  title,
  actionLabel,
  onActionPress,
  actionAccessibilityLabel,
  testID,
}: HomeSectionHeaderProps) {
  const layout = useHomeLayout();

  return (
    <Box
      row
      rtlRow
      center
      testID={testID}
      style={{
        minHeight: layout.touchTarget,
        justifyContent: 'space-between',
      }}>
      <Text variant="subtitle" accessibilityRole="header" style={{ flex: 1 }}>
        {title}
      </Text>
      {actionLabel && onActionPress ? (
        <Pressable
          onPress={onActionPress}
          accessibilityRole="button"
          accessibilityLabel={actionAccessibilityLabel ?? actionLabel}
          style={{
            minHeight: layout.touchTarget,
            minWidth: layout.touchTarget,
            justifyContent: 'center',
            alignItems: 'flex-end',
            paddingLeft: layout.itemGap,
          }}>
          <Text variant="bodySmall" color="primary">
            {actionLabel}
          </Text>
        </Pressable>
      ) : null}
    </Box>
  );
});
