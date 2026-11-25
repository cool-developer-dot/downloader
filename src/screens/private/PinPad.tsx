import { memo, useEffect, useRef } from 'react';
import { Animated, View } from 'react-native';

import { Pressable } from '@/components/base/Pressable';
import { DsIcon, DsText } from '@/design';
import { useTheme } from '@/hooks/use-theme';
import { useTranslation } from '@/localization';

import { PIN_LENGTH, pinPadRows, type PinPadKey, type PinPadState } from './pin-pad';

export type PinPadProps = {
  state: PinPadState;
  onKey: (key: PinPadKey) => void;
  /** The fingerprint key: only while a fingerprint (or face) unlock is offered. */
  biometricOffered: boolean;
  disabled?: boolean;
  /** "Wrong PIN", "Too many attempts…", or null. */
  message?: string | null;
  testID?: string;
};

const KEY_SIZE = 66;
const DOT_SIZE = 13;

/**
 * Files F10 · design 28: the four dots and the 3 × 4 keypad (the fingerprint key, 0 and ⌫ on the last row). The
 * keypad is laid out left to right in every language, so 1-2-3 never mirrors in Urdu. A wrong PIN shakes the dots.
 */
export const PinPad = memo(function PinPad({ state, onKey, biometricOffered, disabled = false, message, testID = 'pin-pad' }: PinPadProps) {
  const theme = useTheme();
  const { t } = useTranslation();
  const shake = useRef(new Animated.Value(0)).current;

  useEffect(() => {
    if (state.shakes === 0) {
      return;
    }
    shake.setValue(0);
    Animated.sequence(
      [10, -10, 8, -8, 4, 0].map((toValue) => Animated.timing(shake, { toValue, duration: 50, useNativeDriver: true })),
    ).start();
  }, [shake, state.shakes]);

  return (
    <View testID={testID} style={{ alignItems: 'center', gap: 18 }}>
      <Animated.View
        accessible
        accessibilityRole="text"
        accessibilityLabel={t('fileManager.pinDotsA11y', { count: state.digits.length, length: PIN_LENGTH })}
        accessibilityLiveRegion="polite"
        style={{ flexDirection: 'row', gap: 16, transform: [{ translateX: shake }] }}>
        {Array.from({ length: PIN_LENGTH }, (_, index) => {
          const filled = index < state.digits.length;
          return (
            <View
              key={index}
              style={{
                width: DOT_SIZE,
                height: DOT_SIZE,
                borderRadius: DOT_SIZE / 2,
                borderWidth: 2,
                borderColor: theme.colors.primary,
                backgroundColor: filled ? theme.colors.primary : 'transparent',
              }}
            />
          );
        })}
      </Animated.View>
      <DsText variant="body" color="error" align="center" accessibilityLiveRegion="assertive" style={{ minHeight: 20 }}>
        {message ?? ''}
      </DsText>
      {/* Always left to right: a phone keypad does not mirror. */}
      <View style={{ gap: 14 }}>
        {pinPadRows(biometricOffered).map((row, rowIndex) => (
          <View key={rowIndex} style={{ flexDirection: 'row', gap: 22 }}>
            {row.map((key, keyIndex) =>
              key === null ? (
                <View key={`empty-${keyIndex}`} style={{ width: KEY_SIZE, height: KEY_SIZE }} />
              ) : (
                <Pressable
                  key={key}
                  onPress={() => onKey(key)}
                  disabled={disabled}
                  accessibilityRole="button"
                  accessibilityLabel={
                    key === 'backspace' ? t('fileManager.keyBackspace') : key === 'biometric' ? t('fileManager.keyFingerprint') : key
                  }
                  testID={`${testID}-${key}`}
                  style={({ pressed }) => ({
                    width: KEY_SIZE,
                    height: KEY_SIZE,
                    borderRadius: KEY_SIZE / 2,
                    alignItems: 'center',
                    justifyContent: 'center',
                    backgroundColor: pressed ? theme.colors.surfacePressed : theme.colors.inputBackground,
                    opacity: disabled ? 0.5 : 1,
                  })}>
                  {key === 'backspace' ? (
                    <DsIcon name="delete" size={24} color="textPrimary" strokeWidth={1.8} />
                  ) : key === 'biometric' ? (
                    <DsIcon name="fingerprint" size={24} color="textPrimary" strokeWidth={1.8} />
                  ) : (
                    <DsText variant="title" color="textPrimary">
                      {key}
                    </DsText>
                  )}
                </Pressable>
              ),
            )}
          </View>
        ))}
      </View>
    </View>
  );
});
