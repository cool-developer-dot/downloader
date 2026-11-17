import { memo } from 'react';
import { View } from 'react-native';

import { DsText } from './DsText';
import { ds } from './tokens';

export type DsSectionLabelProps = {
  children: string;
  /** No space above (the first label on a screen). */
  first?: boolean;
  testID?: string;
};

/** The design's red capitals section label ("QUICK ACCESS", "GROUP HISTORY", "MANAGE"). */
export const DsSectionLabel = memo(function DsSectionLabel({ children, first = false, testID }: DsSectionLabelProps) {
  return (
    <View
      testID={testID}
      accessibilityRole="header"
      style={{ paddingTop: first ? 0 : ds.space.sectionTop - ds.space.stack, paddingBottom: ds.space.sectionBottom - ds.space.stack }}>
      <DsText variant="section">{children}</DsText>
    </View>
  );
});
