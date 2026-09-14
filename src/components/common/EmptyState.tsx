import { memo, type ReactNode } from 'react';
import { type StyleProp, type ViewStyle } from 'react-native';

import { Box } from '@/components/base/Box';
import { Icon, type IconName } from '@/components/base/Icon';
import { Text } from '@/components/base/Text';
import { Button } from '@/components/buttons/Button';

export type EmptyStateProps = {
  icon?: IconName;
  title: string;
  description?: string;
  actionLabel?: string;
  onActionPress?: () => void;
  style?: StyleProp<ViewStyle>;
  testID?: string;
};

export const EmptyState = memo(function EmptyState({
  icon = 'inbox-outline',
  title,
  description,
  actionLabel,
  onActionPress,
  style,
  testID,
}: EmptyStateProps) {
  const action: ReactNode =
    actionLabel && onActionPress ? (
      <Button title={actionLabel} onPress={onActionPress} variant="outline" />
    ) : null;

  return (
    <Box testID={testID} center gap={16} p={24} style={style as ViewStyle | undefined}>
      {icon ? <Icon name={icon} size="xl" color="secondary" /> : null}
      <Box center gap={8}>
        <Text variant="title" align="center">
          {title}
        </Text>
        {description ? (
          <Text variant="bodySmall" color="textSecondary" align="center">
            {description}
          </Text>
        ) : null}
      </Box>
      {action}
    </Box>
  );
});
