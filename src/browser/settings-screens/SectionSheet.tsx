import { memo, type ReactNode } from 'react';
import { View } from 'react-native';

import { SheetFrame } from '@/browser/startup/components/SheetFrame';

/**
 * A bottom sheet that hosts one or more of the existing Browser settings sections (`*SettingsSection`), so a design
 * row opens the controls that were already built for it instead of a second implementation.
 */
export const SectionSheet = memo(function SectionSheet({
  visible,
  title,
  onClose,
  children,
  testID,
}: {
  visible: boolean;
  title: string;
  onClose: () => void;
  children: ReactNode;
  testID?: string;
}) {
  return (
    <SheetFrame visible={visible} title={title} onClose={onClose} testID={testID}>
      <View style={{ gap: 24, paddingBottom: 8 }}>{children}</View>
    </SheetFrame>
  );
});
