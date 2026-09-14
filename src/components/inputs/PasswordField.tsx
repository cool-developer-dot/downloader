import { forwardRef, memo, useCallback, useState } from 'react';
import { TextInput } from 'react-native';

import { IconButton } from '@/components/buttons/IconButton';

import { TextField, type TextFieldProps } from './TextField';

export type PasswordFieldProps = Omit<TextFieldProps, 'secureTextEntry' | 'rightIcon' | 'trailing'>;

export const PasswordField = memo(
  forwardRef<TextInput, PasswordFieldProps>(function PasswordField(props, ref) {
    const [isSecure, setIsSecure] = useState(true);

    const toggleSecure = useCallback(() => {
      setIsSecure((current) => !current);
    }, []);

    return (
      <TextField
        ref={ref}
        {...props}
        secureTextEntry={isSecure}
        textContentType="password"
        autoCapitalize="none"
        autoCorrect={false}
        accessibilityLabel={props.accessibilityLabel ?? props.label ?? 'Password'}
        trailing={
          <IconButton
            icon={isSecure ? 'eye-off' : 'eye'}
            variant="ghost"
            size="small"
            onPress={toggleSecure}
            accessibilityLabel={isSecure ? 'Show password' : 'Hide password'}
          />
        }
      />
    );
  }),
);
