import { forwardRef, memo } from 'react';
import { type View } from 'react-native';

import { Button, type ButtonProps } from './Button';

export type TextButtonProps = Omit<ButtonProps, 'variant'> & {
  variant?: Extract<ButtonProps['variant'], 'text' | 'ghost'>;
};

export const TextButton = memo(
  forwardRef<View, TextButtonProps>(function TextButton({ variant = 'text', ...rest }, ref) {
    return <Button ref={ref} variant={variant} {...rest} />;
  }),
);
