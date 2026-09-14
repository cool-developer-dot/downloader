import { forwardRef, memo, useCallback, useMemo, useRef } from 'react';
import { TextInput, type NativeSyntheticEvent, type TextInputKeyPressEventData } from 'react-native';

import { Box } from '@/components/base/Box';
import { Text } from '@/components/base/Text';
import { useTheme } from '@/hooks/use-theme';

import { fieldMetrics, getFieldColors } from './field-styles';

export type OTPFieldProps = {
  length?: number;
  value: string;
  onChange: (value: string) => void;
  label?: string;
  error?: string;
  disabled?: boolean;
  testID?: string;
};

export const OTPField = memo(
  forwardRef<TextInput, OTPFieldProps>(function OTPField(
    { length = 6, value, onChange, label, error, disabled = false, testID },
    ref,
  ) {
    const theme = useTheme();
    const inputRefs = useRef<(TextInput | null)[]>([]);
    const colors = useMemo(
      () => getFieldColors(theme, disabled ? 'disabled' : error ? 'error' : 'default'),
      [disabled, error, theme],
    );

    const digits = useMemo(
      () => Array.from({ length }, (_, index) => value[index] ?? ''),
      [length, value],
    );

    const focusInput = useCallback((index: number) => {
      inputRefs.current[index]?.focus();
    }, []);

    const handleChange = useCallback(
      (text: string, index: number) => {
        const sanitized = text.replace(/\D/g, '').slice(-1);
        const nextValue = `${value.slice(0, index)}${sanitized}${value.slice(index + 1)}`.slice(0, length);
        onChange(nextValue);

        if (sanitized && index < length - 1) {
          focusInput(index + 1);
        }
      },
      [focusInput, length, onChange, value],
    );

    const handleKeyPress = useCallback(
      (event: NativeSyntheticEvent<TextInputKeyPressEventData>, index: number) => {
        if (event.nativeEvent.key === 'Backspace' && !digits[index] && index > 0) {
          focusInput(index - 1);
        }
      },
      [digits, focusInput],
    );

    return (
      <Box gap={fieldMetrics.gap} testID={testID}>
        {label ? (
          <Text variant="label" style={{ color: colors.labelColor }}>
            {label}
          </Text>
        ) : null}
        <Box row gap={8}>
          {digits.map((digit, index) => (
            <TextInput
              key={`otp-${index}`}
              ref={(instance) => {
                inputRefs.current[index] = instance;

                if (index === 0 && ref) {
                  if (typeof ref === 'function') {
                    ref(instance);
                  } else {
                    ref.current = instance;
                  }
                }
              }}
              value={digit}
              onChangeText={(text) => handleChange(text, index)}
              onKeyPress={(event) => handleKeyPress(event, index)}
              keyboardType="number-pad"
              maxLength={1}
              editable={!disabled}
              accessibilityLabel={`Digit ${index + 1}`}
              style={[
                theme.typography.title,
                {
                  flex: 1,
                  minHeight: fieldMetrics.minHeight,
                  textAlign: 'center',
                  borderWidth: 1,
                  borderColor: colors.borderColor,
                  borderRadius: fieldMetrics.borderRadius,
                  backgroundColor: colors.backgroundColor,
                  color: colors.textColor,
                },
              ]}
            />
          ))}
        </Box>
        {error ? (
          <Text variant="caption" style={{ color: colors.helperColor }}>
            {error}
          </Text>
        ) : null}
      </Box>
    );
  }),
);
