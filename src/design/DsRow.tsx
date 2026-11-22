import { Children, Fragment, isValidElement, memo, type ReactNode } from 'react';
import { View, type StyleProp, type ViewStyle } from 'react-native';

import { Pressable } from '@/components/base/Pressable';
import { useTheme } from '@/hooks/use-theme';
import { useRtl } from '@/localization';

import { DsCard } from './DsCard';
import { DsIcon, type DsIconName } from './DsIcon';
import { DsText } from './DsText';
import { DsToggle } from './DsToggle';
import { ds } from './tokens';

export type DsRowProps = {
  /** The red stroke icon on the 34 dp soft-red tile. */
  icon?: DsIconName;
  /** Any element in the tile's place (a favicon, a check box…). */
  leading?: ReactNode;
  title: string;
  subtitle?: string;
  /** Right-hand plain text (the design's "110%", "8", "Off"). */
  value?: string;
  /** A switch at the right; the row itself then toggles it when tapped (unless `onPress` is set). */
  toggle?: { value: boolean; onValueChange: (next: boolean) => void; accessibilityLabel?: string; accessibilityHint?: string };
  /** `chevron` (default when `onPress` is set and there is no toggle / value / custom trailing), `none`, or an element. */
  trailing?: 'chevron' | 'none' | ReactNode;
  onPress?: () => void;
  onLongPress?: () => void;
  disabled?: boolean;
  /** Title and icon in the accent colour (the design's destructive rows keep the same look, so this is opt-in). */
  destructive?: boolean;
  accessibilityLabel?: string;
  accessibilityHint?: string;
  style?: StyleProp<ViewStyle>;
  testID?: string;
};

/**
 * The design's list row: icon tile · title / subtitle · chevron | toggle | value. 58 dp minimum, 13 dp side padding,
 * 12 dp between tile and text. Put rows in a `DsRowGroup` for the card and the hairline dividers.
 */
export const DsRow = memo(function DsRow({
  icon,
  leading,
  title,
  subtitle,
  value,
  toggle,
  trailing,
  onPress,
  onLongPress,
  disabled = false,
  destructive = false,
  accessibilityLabel,
  accessibilityHint,
  style,
  testID,
}: DsRowProps) {
  const theme = useTheme();
  const rtl = useRtl();
  const interactive = Boolean(onPress || onLongPress || toggle) && !disabled;
  const showChevron = trailing === 'chevron' || (trailing === undefined && Boolean(onPress) && !toggle && value == null);
  const handlePress = onPress ?? (toggle ? () => toggle.onValueChange(!toggle.value) : undefined);

  const content = (
    <View
      style={[
        {
          flexDirection: rtl.rowDirection,
          alignItems: 'center',
          gap: ds.space.rowGap,
          minHeight: ds.size.rowMinHeight,
          paddingHorizontal: ds.space.cardPad,
          paddingVertical: ds.space.rowPadY,
          opacity: disabled ? 0.5 : 1,
        },
        style,
      ]}>
      {leading ??
        (icon ? (
          <View
            style={{
              width: ds.size.iconTile,
              height: ds.size.iconTile,
              borderRadius: ds.radius.iconTile,
              backgroundColor: theme.colors.accentSoft,
              alignItems: 'center',
              justifyContent: 'center',
            }}>
            <DsIcon name={icon} size={ds.size.rowIcon} color="primary" strokeWidth={ds.stroke.row} />
          </View>
        ) : null)}
      <View style={{ flex: 1, gap: 1 }}>
        <DsText variant="rowTitle" color={destructive ? 'primary' : 'textPrimary'}>
          {title}
        </DsText>
        {subtitle ? <DsText variant="rowSub">{subtitle}</DsText> : null}
      </View>
      {value != null ? <DsText variant="rowValue">{value}</DsText> : null}
      {toggle ? (
        <DsToggle
          value={toggle.value}
          onValueChange={toggle.onValueChange}
          accessibilityLabel={toggle.accessibilityLabel ?? title}
          accessibilityHint={toggle.accessibilityHint}
          disabled={disabled}
        />
      ) : null}
      {showChevron ? (
        <DsIcon name={rtl.isRtl ? 'chevron-left' : 'chevron-right'} size={ds.size.rowChevron} color="textSecondary" strokeWidth={1.8} />
      ) : null}
      {isValidElement(trailing) ? trailing : null}
    </View>
  );

  if (!interactive || (toggle && !onPress && !onLongPress)) {
    // A toggle row: the switch is the control; the row stays a plain view so TalkBack reads one switch.
    return (
      <View testID={testID} accessible={false}>
        {content}
      </View>
    );
  }

  return (
    <Pressable
      testID={testID}
      onPress={handlePress}
      onLongPress={onLongPress}
      disabled={disabled}
      accessibilityRole="button"
      accessibilityLabel={accessibilityLabel ?? (subtitle ? `${title}, ${subtitle}` : title)}
      accessibilityHint={accessibilityHint}
      style={({ pressed }) => ({ backgroundColor: pressed ? theme.colors.surfacePressed : 'transparent' })}>
      {content}
    </Pressable>
  );
});

export type DsRowGroupProps = {
  children: ReactNode;
  style?: StyleProp<ViewStyle>;
  testID?: string;
};

/** A white card of rows with the 1 dp #EDEDF0 line between them. `null` children are skipped. */
export const DsRowGroup = memo(function DsRowGroup({ children, style, testID }: DsRowGroupProps) {
  const theme = useTheme();
  const rows = Children.toArray(children).filter(Boolean);
  return (
    <DsCard padded={false} style={style} testID={testID}>
      {rows.map((row, index) => (
        <Fragment key={isValidElement(row) && row.key != null ? row.key : index}>
          {index > 0 ? <View style={{ height: 1, backgroundColor: theme.colors.divider }} /> : null}
          {row}
        </Fragment>
      ))}
    </DsCard>
  );
});
