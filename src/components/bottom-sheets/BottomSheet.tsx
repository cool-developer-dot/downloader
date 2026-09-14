import BottomSheetLib, {
  BottomSheetBackdrop,
  BottomSheetView,
  type BottomSheetProps as GorhomBottomSheetProps,
} from '@gorhom/bottom-sheet';
import { forwardRef, memo, useCallback, useMemo, type PropsWithChildren, type ReactNode } from 'react';
import { StyleSheet } from 'react-native';

import { Box } from '@/components/base/Box';
import { Text } from '@/components/base/Text';
import { useTheme } from '@/hooks/use-theme';
import { animations } from '@/theme';

export type BottomSheetProps = PropsWithChildren<
  Omit<GorhomBottomSheetProps, 'children'> & {
    title?: string;
    subtitle?: string;
    footer?: ReactNode;
  }
>;

export const BottomSheet = memo(
  forwardRef<BottomSheetLib, BottomSheetProps>(function BottomSheet(
    { title, subtitle, footer, children, snapPoints, ...rest },
    ref,
  ) {
    const theme = useTheme();
    const resolvedSnapPoints = useMemo(
      () => snapPoints ?? ['40%', '75%'],
      [snapPoints],
    );

    const renderBackdrop = useCallback(
      (props: Parameters<NonNullable<GorhomBottomSheetProps['backdropComponent']>>[0]) => (
        <BottomSheetBackdrop {...props} appearsOnIndex={0} disappearsOnIndex={-1} opacity={theme.opacity.overlay} />
      ),
      [theme.opacity.overlay],
    );

    return (
      <BottomSheetLib
        ref={ref}
        snapPoints={resolvedSnapPoints}
        enablePanDownToClose
        animationConfigs={{ duration: animations.bottomSheetTransition }}
        backdropComponent={renderBackdrop}
        backgroundStyle={{
          backgroundColor: theme.colors.card,
          borderTopLeftRadius: theme.radius.xl,
          borderTopRightRadius: theme.radius.xl,
        }}
        handleIndicatorStyle={{ backgroundColor: theme.colors.border, width: theme.spacing[40] }}
        {...rest}>
        <BottomSheetView style={styles.content}>
          {title || subtitle ? (
            <Box gap={4} mb={16}>
              {title ? <Text variant="title">{title}</Text> : null}
              {subtitle ? (
                <Text variant="bodySmall" color="textSecondary">
                  {subtitle}
                </Text>
              ) : null}
            </Box>
          ) : null}
          {children}
          {footer}
        </BottomSheetView>
      </BottomSheetLib>
    );
  }),
);

const styles = StyleSheet.create({
  content: {
    flex: 1,
    paddingHorizontal: 16,
    paddingBottom: 24,
  },
});
