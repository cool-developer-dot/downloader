import { forwardRef, memo, useCallback } from 'react';
import { TextInput, type TextInputProps } from 'react-native';

import { TextField, type TextFieldProps } from './TextField';

export type SearchFieldProps = Omit<TextFieldProps, 'leftIcon' | 'clearable'> & {
  onSearch?: (value: string) => void;
};

export const SearchField = memo(
  forwardRef<TextInput, SearchFieldProps>(function SearchField(
    { value, onChangeText, onSearch, onSubmitEditing, placeholder = 'Search', ...rest },
    ref,
  ) {
    const handleSubmit: TextInputProps['onSubmitEditing'] = useCallback(
      (event) => {
        onSearch?.(event.nativeEvent.text);
        onSubmitEditing?.(event);
      },
      [onSearch, onSubmitEditing],
    );

    return (
      <TextField
        ref={ref}
        value={value}
        onChangeText={onChangeText}
        leftIcon="magnify"
        clearable
        returnKeyType="search"
        placeholder={placeholder}
        onSubmitEditing={handleSubmit}
        accessibilityLabel={rest.accessibilityLabel ?? placeholder}
        {...rest}
      />
    );
  }),
);
