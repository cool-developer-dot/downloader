import { memo, type PropsWithChildren, type ReactNode } from 'react';
import { type StyleProp, type ViewStyle } from 'react-native';

import { Box } from '@/components/base/Box';
import { Text } from '@/components/base/Text';

export type SectionProps = PropsWithChildren<{
  title?: string;
  subtitle?: string;
  action?: ReactNode;
  style?: StyleProp<ViewStyle>;
  testID?: string;
}>;

export const Section = memo(function Section({
  title,
  subtitle,
  action,
  children,
  style,
  testID,
}: SectionProps) {
  return (
    <Box testID={testID} gap={12} style={style ? [style] : undefined}>
      {title || subtitle || action ? (
        <Box row center gap={12}>
          <Box flex={1} gap={4}>
            {title ? <Text variant="title">{title}</Text> : null}
            {subtitle ? (
              <Text variant="bodySmall" color="textSecondary">
                {subtitle}
              </Text>
            ) : null}
          </Box>
          {action}
        </Box>
      ) : null}
      {children}
    </Box>
  );
});
