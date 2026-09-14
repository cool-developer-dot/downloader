import { forwardRef, memo, useCallback, useMemo } from 'react';
import { ActivityIndicator, type View } from 'react-native';

import { Pressable } from '@/components/base/Pressable';
import { useTheme } from '@/hooks/use-theme';

import { ButtonContent, type BaseButtonProps } from './button-shared';
import { buttonMetrics, getButtonIconColor, getButtonVisualStyle } from './button-styles';

export type ButtonProps = BaseButtonProps;

export const Button = memo(
  forwardRef<View, ButtonProps>(function Button(
    {
      title,
      variant = 'primary',
      size = 'medium',
      loading = false,
      disabled = false,
      leftIcon,
      rightIcon,
      fullWidth = false,
      onPress,
      accessibilityLabel,
      accessibilityHint,
      accessibilityRole = 'button',
      style,
      testID,
    },
    ref,
  ) {
    const theme = useTheme();
    const metrics = buttonMetrics[size];
    const isDisabled = disabled || loading;
    const visualStyle = useMemo(
      () => getButtonVisualStyle(theme, variant, isDisabled),
      [isDisabled, theme, variant],
    );

    const handlePress = useCallback(() => {
      if (!isDisabled) {
        onPress?.();
      }
    }, [isDisabled, onPress]);

    const iconColor = getButtonIconColor(variant, isDisabled);

    return (
      <Pressable
        ref={ref}
        testID={testID}
        onPress={handlePress}
        disabled={isDisabled}
        accessibilityRole={accessibilityRole}
        accessibilityLabel={accessibilityLabel ?? title}
        accessibilityHint={accessibilityHint}
        accessibilityState={{ disabled: isDisabled, busy: loading }}
        style={[
          {
            minHeight: metrics.height,
            paddingHorizontal: metrics.paddingHorizontal,
            borderRadius: metrics.borderRadius,
            backgroundColor: visualStyle.backgroundColor,
            borderColor: visualStyle.borderColor,
            borderWidth: visualStyle.borderWidth,
            alignItems: 'center',
            justifyContent: 'center',
            alignSelf: fullWidth ? 'stretch' : 'flex-start',
            width: fullWidth ? '100%' : undefined,
          },
          style,
        ]}>
        {loading && !title && !leftIcon && !rightIcon ? (
          <ActivityIndicator color={visualStyle.textColor} />
        ) : (
          <ButtonContent
            title={title}
            variant={variant}
            size={size}
            loading={loading}
            leftIcon={leftIcon}
            rightIcon={rightIcon}
            textColor={visualStyle.textColor}
            iconColor={iconColor}
            iconSize={metrics.iconSize}
          />
        )}
      </Pressable>
    );
  }),
);
