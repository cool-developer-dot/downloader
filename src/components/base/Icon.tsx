import { memo, useMemo } from 'react';
import { Icon as PaperIcon } from 'react-native-paper';

import { View } from 'react-native';

import { useTheme } from '@/hooks/use-theme';
import { iconColors, icons } from '@/theme/icons';

import type { IconColorToken, IconSizeToken } from './types';

export type IconName = string;

export type IconProps = {
  name: IconName;
  size?: IconSizeToken | number;
  color?: IconColorToken;
  accessibilityLabel?: string;
};

export const Icon = memo(function Icon({
  name,
  size = 'md',
  color = 'default',
  accessibilityLabel,
}: IconProps) {
  const theme = useTheme();

  const resolvedSize = useMemo(
    () => (typeof size === 'number' ? size : icons[size]),
    [size],
  );

  const resolvedColor = useMemo(() => theme.colors[iconColors[color]], [color, theme.colors]);

  return (
    <View accessibilityLabel={accessibilityLabel} accessible={Boolean(accessibilityLabel)}>
      <PaperIcon source={name} size={resolvedSize} color={resolvedColor} />
    </View>
  );
});
