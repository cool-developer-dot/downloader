import { memo } from 'react';
import { type ColorValue } from 'react-native';
import { Icon as PaperIcon } from 'react-native-paper';

export type TabBarIconProps = {
  name: string;
  color: ColorValue;
  size: number;
};

export const TabBarIcon = memo(function TabBarIcon({ name, color, size }: TabBarIconProps) {
  return <PaperIcon source={name} size={size} color={String(color)} />;
});
