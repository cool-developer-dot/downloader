import { forwardRef, memo } from 'react';
import { type View } from 'react-native';

import { Button, type ButtonProps } from './Button';

export type LoadingButtonProps = Omit<ButtonProps, 'loading'> & {
  loading: boolean;
};

export const LoadingButton = memo(
  forwardRef<View, LoadingButtonProps>(function LoadingButton(props, ref) {
    return <Button ref={ref} {...props} />;
  }),
);
