import { memo, type ReactNode } from 'react';
import { View } from 'react-native';

import { ds, DsSectionLabel } from '@/design';
import { useTheme } from '@/hooks/use-theme';
import { useRtl } from '@/localization';

export type DownloadSectionHeaderProps = {
  title: string;
  count?: number;
  testID?: string;
  /** Shown at the end of the header (H4: the Queued section's Reorder button). */
  action?: ReactNode;
};

/** A list section ("Running · 3") as the design's red capitals label, on the page colour so it can stick. */
export const DownloadSectionHeader = memo(function DownloadSectionHeader({
  title,
  count,
  testID,
  action,
}: DownloadSectionHeaderProps) {
  const theme = useTheme();
  const rtl = useRtl();
  const label = typeof count === 'number' ? `${title} · ${count}` : title;

  return (
    <View
      testID={testID}
      accessibilityLabel={label}
      style={{
        flexDirection: rtl.rowDirection,
        alignItems: 'center',
        justifyContent: 'space-between',
        paddingTop: 4,
        paddingBottom: ds.space.sectionBottom,
        backgroundColor: theme.colors.background,
      }}>
      <DsSectionLabel>{label}</DsSectionLabel>
      {action ? <View>{action}</View> : null}
    </View>
  );
});
