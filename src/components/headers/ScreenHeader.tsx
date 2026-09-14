import { memo, type ReactNode } from 'react';
import { type StyleProp, type ViewStyle } from 'react-native';

import { AppHeader } from './AppHeader';

export type ScreenHeaderProps = {
  title: string;
  subtitle?: string;
  showBack?: boolean;
  onBackPress?: () => void;
  actions?: ReactNode;
  style?: StyleProp<ViewStyle>;
  testID?: string;
};

export const ScreenHeader = memo(function ScreenHeader(props: ScreenHeaderProps) {
  return <AppHeader {...props} />;
});
