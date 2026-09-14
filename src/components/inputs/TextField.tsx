import { forwardRef, memo, useCallback, useMemo, useState, type ReactNode } from 'react';
import {
  TextInput,
  type TextInputProps,
  type StyleProp,
  type TextStyle,
  type ViewStyle,
} from 'react-native';

import { Box } from '@/components/base/Box';
import { Icon, type IconName } from '@/components/base/Icon';
import { Pressable } from '@/components/base/Pressable';
import { Text } from '@/components/base/Text';
import { useTheme } from '@/hooks/use-theme';
import { useTranslation } from '@/localization';

import { fieldMetrics, getFieldColors, type FieldState } from './field-styles';

export type TextFieldProps = Omit<TextInputProps, 'editable'> & {
  label?: string;
  helperText?: string;
  error?: string;
  leftIcon?: IconName;
  rightIcon?: IconName;
  trailing?: ReactNode;
  clearable?: boolean;
  disabled?: boolean;
  readOnly?: boolean;
  containerStyle?: StyleProp<ViewStyle>;
  inputStyle?: StyleProp<TextStyle>;
  onClear?: () => void;
};

export const TextField = memo(
  forwardRef<TextInput, TextFieldProps>(function TextField(
    {
      label,
      helperText,
      error,
      leftIcon,
      rightIcon,
      trailing,
      clearable = false,
      disabled = false,
      readOnly = false,
      value,
      onChangeText,
      onClear,
      containerStyle,
      inputStyle,
      placeholder,
      accessibilityLabel,
      ...rest
    },
    ref,
  ) {
    const theme = useTheme();
    const { t } = useTranslation();
    const [isFocused, setIsFocused] = useState(false);

    const fieldState: FieldState = useMemo(() => {
      if (disabled) {
        return 'disabled';
      }

      if (readOnly) {
        return 'readonly';
      }

      if (error) {
        return 'error';
      }

      return 'default';
    }, [disabled, error, readOnly]);

    const colors = useMemo(() => getFieldColors(theme, fieldState), [fieldState, theme]);

    const handleClear = useCallback(() => {
      onChangeText?.('');
      onClear?.();
    }, [onChangeText, onClear]);

    const showClearButton = clearable && Boolean(value) && !disabled && !readOnly;

    return (
      <Box gap={fieldMetrics.gap} style={containerStyle ? [containerStyle] : undefined}>
        {label ? (
          <Text variant="label" style={{ color: colors.labelColor }}>
            {label}
          </Text>
        ) : null}
        <Box
          row
          center
          gap={8}
          style={{
            minHeight: fieldMetrics.minHeight,
            paddingHorizontal: fieldMetrics.paddingHorizontal,
            borderRadius: fieldMetrics.borderRadius,
            borderWidth: 1,
            borderColor: isFocused && fieldState === 'default' ? theme.colors.primary : colors.borderColor,
            backgroundColor: colors.backgroundColor,
          }}>
          {leftIcon ? <Icon name={leftIcon} size="sm" color="secondary" /> : null}
          <TextInput
            ref={ref}
            value={value}
            onChangeText={onChangeText}
            editable={!disabled && !readOnly}
            placeholder={placeholder}
            placeholderTextColor={theme.colors.textDisabled}
            onFocus={() => setIsFocused(true)}
            onBlur={() => setIsFocused(false)}
            accessibilityLabel={accessibilityLabel ?? label ?? placeholder}
            accessibilityState={{ disabled }}
            style={[
              theme.typography.body,
              {
                flex: 1,
                color: colors.textColor,
                paddingVertical: theme.spacing[12],
              },
              inputStyle,
            ]}
            {...rest}
          />
          {showClearButton ? (
            <Pressable
              onPress={handleClear}
              accessibilityRole="button"
              accessibilityLabel={t('common.clearInput')}>
              <Icon name="close-circle" size="sm" color="secondary" />
            </Pressable>
          ) : null}
          {!showClearButton && trailing}
          {!showClearButton && !trailing && rightIcon ? <Icon name={rightIcon} size="sm" color="secondary" /> : null}
        </Box>
        {error || helperText ? (
          <Text variant="caption" style={{ color: colors.helperColor }}>
            {error ?? helperText}
          </Text>
        ) : null}
      </Box>
    );
  }),
);
