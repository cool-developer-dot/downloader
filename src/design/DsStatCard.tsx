import { memo } from 'react';
import { type StyleProp, type ViewStyle } from 'react-native';

import { DsCard } from './DsCard';
import { DsText } from './DsText';

export type DsStatCardProps = {
  value: string;
  label: string;
  style?: StyleProp<ViewStyle>;
  testID?: string;
};

/** The statistics screen's small card: a 34 dp semibold figure over a secondary label, centred. */
export const DsStatCard = memo(function DsStatCard({ value, label, style, testID }: DsStatCardProps) {
  return (
    <DsCard style={[{ flex: 1, alignItems: 'center', paddingVertical: 14 }, style]} testID={testID}>
      <DsText variant="stat" align="center" numberOfLines={1} adjustsFontSizeToFit>
        {value}
      </DsText>
      <DsText variant="rowSub" align="center" numberOfLines={1}>
        {label}
      </DsText>
    </DsCard>
  );
});
