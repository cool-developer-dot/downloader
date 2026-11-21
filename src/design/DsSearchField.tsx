import { forwardRef, memo, type ReactNode } from 'react';
import { TextInput, View, type StyleProp, type TextInputProps, type ViewStyle } from 'react-native';

import { Pressable } from '@/components/base/Pressable';
import { useTheme } from '@/hooks/use-theme';
import { useRtl } from '@/localization';
import { nativeFontFamilies } from '@/theme/typography';

import { DsIcon, type DsIconName } from './DsIcon';
import { DsText } from './DsText';
import { ds } from './tokens';

export type DsSearchFieldAction = {
  icon: DsIconName;
  accessibilityLabel: string;
  onPress: () => void;
  testID?: string;
};

export type DsSearchFieldProps = Omit<TextInputProps, 'style'> & {
  /** Leading icon (the design: a search glass; none for the plain "https://…" field). */
  icon?: DsIconName | null;
  /** Up to two small actions at the end (mic · camera, mic · ✕). */
  actions?: DsSearchFieldAction[];
  /** When set, the field is a button that opens something else (no keyboard here). */
  onPress?: () => void;
  trailing?: ReactNode;
  style?: StyleProp<ViewStyle>;
  testID?: string;
};

/**
 * The design's 56 dp white field with 16 dp corners: a search glass, 15 dp text or placeholder, and small grey
 * actions at the end. Either a real TextInput, or (with `onPress`) a button that looks like one.
 */
export const DsSearchField = memo(
  forwardRef<TextInput, DsSearchFieldProps>(function DsSearchField(
    { icon = 'search', actions, onPress, trailing, style, testID, placeholder, value, ...input },
    ref,
  ) {
    const theme = useTheme();
    const rtl = useRtl();

    const frame: ViewStyle = {
      height: ds.size.field,
      borderRadius: ds.radius.field,
      backgroundColor: theme.colors.card,
      borderWidth: 1,
      borderColor: theme.colors.cardBorder,
      flexDirection: rtl.rowDirection,
      alignItems: 'center',
      paddingStart: 20,
      paddingEnd: 16,
      gap: 14,
    };

    const trail =
      trailing ??
      (actions && actions.length > 0 ? (
        <View style={{ flexDirection: rtl.rowDirection, alignItems: 'center', gap: 12 }}>
          {actions.map((action) => (
            <Pressable
              key={action.icon}
              onPress={action.onPress}
              accessibilityRole="button"
              accessibilityLabel={action.accessibilityLabel}
              hitSlop={10}
              testID={action.testID}
              style={{ width: 28, height: 28, alignItems: 'center', justifyContent: 'center' }}>
              <DsIcon name={action.icon} size={ds.size.fieldIcon} color="textSecondary" strokeWidth={1.7} />
            </Pressable>
          ))}
        </View>
      ) : null);

    if (onPress) {
      return (
        <Pressable
          testID={testID}
          onPress={onPress}
          accessibilityRole="button"
          accessibilityLabel={input.accessibilityLabel ?? placeholder}
          style={({ pressed }) => [frame, { backgroundColor: pressed ? theme.colors.surfacePressed : theme.colors.card }, style]}>
          {icon ? <DsIcon name={icon} size={ds.size.fieldIcon + 2} color="textPrimary" strokeWidth={2} /> : null}
          <DsText variant="rowTitle" color={value ? 'textPrimary' : 'textSecondary'} numberOfLines={1} style={{ flex: 1, fontFamily: nativeFontFamilies.body }}>
            {value || placeholder}
          </DsText>
          {trail}
        </Pressable>
      );
    }

    return (
      <View testID={testID} style={[frame, style]}>
        {icon ? <DsIcon name={icon} size={ds.size.fieldIcon + 2} color="textPrimary" strokeWidth={2} /> : null}
        <TextInput
          ref={ref}
          value={value}
          placeholder={placeholder}
          placeholderTextColor={theme.colors.textSecondary}
          selectionColor={theme.colors.primary}
          underlineColorAndroid="transparent"
          {...input}
          style={{
            flex: 1,
            padding: 0,
            margin: 0,
            fontFamily: nativeFontFamilies.body,
            fontSize: ds.text.rowTitle,
            color: theme.colors.textPrimary,
            textAlign: rtl.textAlign,
            writingDirection: rtl.writingDirection,
          }}
        />
        {trail}
      </View>
    );
  }),
);
