import { memo, type ReactNode } from 'react';

import { Box } from '@/components/base/Box';
import { Icon } from '@/components/base/Icon';
import { Pressable } from '@/components/base/Pressable';
import { Text } from '@/components/base/Text';
import { useTranslation } from '@/localization';

/** B21 — one choice in a radio group (≥ 48 dp, mirrored in RTL, announced with its checked state). */
export const RadioRow = memo(function RadioRow({
  label,
  description,
  selected,
  onPress,
  leading,
  testID,
}: {
  label: string;
  description?: string;
  selected: boolean;
  onPress: () => void;
  leading?: ReactNode;
  testID?: string;
}) {
  const { t, rtl } = useTranslation();
  return (
    <Pressable
      testID={testID}
      accessibilityRole="radio"
      accessibilityState={{ checked: selected }}
      accessibilityLabel={selected ? t('browserSettings.selectedA11y', { label }) : label}
      accessibilityHint={description}
      onPress={onPress}
      style={{ minHeight: 48, paddingVertical: 8, flexDirection: rtl.rowDirection, alignItems: 'center', gap: 12 }}>
      <Icon name={selected ? 'radiobox-marked' : 'radiobox-blank'} size={22} color={selected ? 'primary' : 'secondary'} />
      {leading}
      <Box flex={1} style={{ minWidth: 0 }}>
        <Text variant="body" color={selected ? 'primary' : 'textPrimary'}>
          {label}
        </Text>
        {description ? (
          <Text variant="caption" color="textSecondary">
            {description}
          </Text>
        ) : null}
      </Box>
    </Pressable>
  );
});
