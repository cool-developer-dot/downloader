import { memo, useCallback, useEffect, useRef } from 'react';
import {
  Pressable,
  TextInput,
  View,
  type StyleProp,
  type ViewStyle,
} from 'react-native';

import { Text } from '@/components/base/Text';
import { useTheme } from '@/hooks/use-theme';

import { APP_LOCK_PIN_LENGTH } from './app-lock.constants';

export type AppLockPinInputProps = {
  value: string;
  onChange: (next: string) => void;
  onComplete?: (pin: string) => void;
  disabled?: boolean;
  error?: string | null;
  accessibilityLabel: string;
  testID?: string;
  style?: StyleProp<ViewStyle>;
  autoFocus?: boolean;
};

/**
 * 4-digit obscured PIN entry. PIN stays in local controlled state only.
 */
export const AppLockPinInput = memo(function AppLockPinInput({
  value,
  onChange,
  onComplete,
  disabled = false,
  error,
  accessibilityLabel,
  testID = 'app-lock-pin-input',
  style,
  autoFocus = true,
}: AppLockPinInputProps) {
  const theme = useTheme();
  const inputRef = useRef<TextInput>(null);
  const completedRef = useRef<string | null>(null);

  useEffect(() => {
    if (autoFocus && !disabled) {
      const id = setTimeout(() => inputRef.current?.focus(), 80);
      return () => clearTimeout(id);
    }
    return undefined;
  }, [autoFocus, disabled]);

  useEffect(() => {
    if (value.length === APP_LOCK_PIN_LENGTH && onComplete) {
      if (completedRef.current === value) {
        return;
      }
      completedRef.current = value;
      onComplete(value);
    } else if (value.length < APP_LOCK_PIN_LENGTH) {
      completedRef.current = null;
    }
  }, [value, onComplete]);

  const handleChange = useCallback(
    (raw: string) => {
      if (disabled) {
        return;
      }
      const digits = raw.replace(/\D/g, '').slice(0, APP_LOCK_PIN_LENGTH);
      onChange(digits);
    },
    [disabled, onChange],
  );

  const focusInput = useCallback(() => {
    if (!disabled) {
      inputRef.current?.focus();
    }
  }, [disabled]);

  return (
    <View style={style} testID={testID}>
      <Pressable
        onPress={focusInput}
        accessibilityRole="none"
        style={{
          flexDirection: 'row',
          justifyContent: 'center',
          gap: 14,
          marginBottom: 8,
        }}>
        {Array.from({ length: APP_LOCK_PIN_LENGTH }).map((_, index) => {
          const filled = index < value.length;
          return (
            <View
              key={`dot-${index}`}
              accessibilityElementsHidden
              importantForAccessibility="no-hide-descendants"
              style={{
                width: 18,
                height: 18,
                borderRadius: 9,
                borderWidth: 2,
                borderColor: error
                  ? theme.colors.error
                  : filled
                    ? theme.colors.primary
                    : theme.colors.border,
                backgroundColor: filled
                  ? error
                    ? theme.colors.error
                    : theme.colors.primary
                  : 'transparent',
              }}
            />
          );
        })}
      </Pressable>

      <TextInput
        ref={inputRef}
        value={value}
        onChangeText={handleChange}
        keyboardType="number-pad"
        textContentType="oneTimeCode"
        autoComplete="off"
        importantForAutofill="no"
        secureTextEntry
        maxLength={APP_LOCK_PIN_LENGTH}
        editable={!disabled}
        caretHidden
        contextMenuHidden
        style={{
          position: 'absolute',
          opacity: 0.01,
          height: 1,
          width: 1,
        }}
        accessibilityLabel={accessibilityLabel}
        accessibilityHint={`${value.length} of ${APP_LOCK_PIN_LENGTH} digits entered`}
        testID={`${testID}-field`}
      />

      {error ? (
        <Text
          variant="caption"
          color="error"
          align="center"
          style={{ marginTop: 10 }}
          accessibilityLiveRegion="polite"
          testID={`${testID}-error`}>
          {error}
        </Text>
      ) : null}
    </View>
  );
});
