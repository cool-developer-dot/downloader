import { memo } from 'react';
import { View } from 'react-native';

import { Box } from '@/components/base/Box';
import { Icon } from '@/components/base/Icon';
import { Pressable } from '@/components/base/Pressable';
import { Text } from '@/components/base/Text';
import { Switch } from '@/components/inputs/Switch';
import { useTheme } from '@/hooks/use-theme';
import { BROWSER_TOUCH_TARGET } from '@/browser/constants';
import { primaryAlphas } from '@/theme';

import type { BrowserMenuItemModel } from './types';

export type BrowserMenuItemProps = {
  item: BrowserMenuItemModel;
  onPress: (id: BrowserMenuItemModel['id']) => void;
  onToggle?: (id: BrowserMenuItemModel['id'], enabled: boolean) => void;
  testID?: string;
};

export const BrowserMenuItem = memo(function BrowserMenuItem({
  item,
  onPress,
  onToggle,
  testID,
}: BrowserMenuItemProps) {
  const theme = useTheme();
  const primary = primaryAlphas(theme.colors.primary);
  const isToggle = item.kind === 'toggle';

  const iconSlot = (
    <View
      style={{
        width: 32,
        height: 32,
        borderRadius: theme.radius.sm,
        alignItems: 'center',
        justifyContent: 'center',
        backgroundColor: item.enabled ? primary.subtle : 'transparent',
      }}
      accessibilityElementsHidden
      importantForAccessibility="no">
      <Icon name={item.icon} size="sm" color={item.enabled ? 'primary' : 'disabled'} />
    </View>
  );

  const labelSlot = (
    <Box flex={1}>
      <Text variant="body" numberOfLines={1} style={{ color: theme.colors.textPrimary }}>
        {item.label}
      </Text>
    </Box>
  );

  if (isToggle) {
    return (
      <View
        testID={testID}
        style={{
          minHeight: BROWSER_TOUCH_TARGET,
          paddingHorizontal: 14,
          paddingVertical: 10,
          flexDirection: 'row',
          alignItems: 'center',
          gap: 12,
          opacity: item.enabled ? 1 : 0.45,
        }}>
        {iconSlot}
        {labelSlot}
        <Switch
          value={Boolean(item.toggled)}
          onValueChange={(next) => onToggle?.(item.id, next)}
          disabled={!item.enabled}
          accessibilityLabel={item.accessibilityLabel}
        />
      </View>
    );
  }

  return (
        <Pressable
          testID={testID}
          onPress={() => {
            if (item.enabled) {
              onPress(item.id);
            }
          }}
          disabled={!item.enabled}
          accessibilityRole="menuitem"
          accessibilityLabel={item.accessibilityLabel}
          accessibilityState={{ disabled: !item.enabled }}
      style={({ pressed }) => ({
        minHeight: BROWSER_TOUCH_TARGET,
        paddingHorizontal: 14,
        paddingVertical: 10,
        flexDirection: 'row',
        alignItems: 'center',
        gap: 12,
        opacity: item.enabled ? 1 : 0.45,
        backgroundColor: pressed && item.enabled ? primary.pressed : 'transparent',
      })}>
      {iconSlot}
      {labelSlot}
    </Pressable>
  );
});
