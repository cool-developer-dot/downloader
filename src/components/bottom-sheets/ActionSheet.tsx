import { forwardRef, memo, useCallback } from 'react';

import { Box } from '@/components/base/Box';
import { Icon, type IconName } from '@/components/base/Icon';
import { Pressable } from '@/components/base/Pressable';
import { Text } from '@/components/base/Text';
import { Divider } from '@/components/common/Divider';
import { useTheme } from '@/hooks/use-theme';
import { useTranslation } from '@/localization';

import { BottomSheet, type BottomSheetProps } from './BottomSheet';

export type ActionSheetItem = {
  id: string;
  label: string;
  icon?: IconName;
  destructive?: boolean;
  selected?: boolean;
  onPress?: () => void;
};

export type ActionSheetProps = Omit<BottomSheetProps, 'children'> & {
  actions: ActionSheetItem[];
  cancelLabel?: string;
  onCancel?: () => void;
};

export const ActionSheet = memo(
  forwardRef<import('@gorhom/bottom-sheet').default, ActionSheetProps>(function ActionSheet(
    { actions, cancelLabel, onCancel, title, subtitle, ...rest },
    ref,
  ) {
    const theme = useTheme();
    const { t, rtl } = useTranslation();
    const resolvedCancel = cancelLabel ?? t('common.cancel');

    const handleActionPress = useCallback(
      (action: ActionSheetItem) => {
        action.onPress?.();
        onCancel?.();
      },
      [onCancel],
    );

    return (
      <BottomSheet ref={ref} title={title} subtitle={subtitle} snapPoints={['35%']} {...rest}>
        <Box gap={8}>
          {actions.map((action, index) => (
            <Box key={action.id} gap={8}>
              <Pressable
                onPress={() => handleActionPress(action)}
                accessibilityRole="button"
                accessibilityLabel={
                  action.selected
                    ? t('settings.languageSelected', { label: action.label })
                    : action.label
                }
                accessibilityState={{ selected: action.selected === true }}
                style={{
                  flexDirection: rtl.rowDirection,
                  alignItems: 'center',
                  gap: theme.spacing[12],
                  paddingVertical: theme.spacing[12],
                }}>
                {action.icon ? (
                  <Icon
                    name={action.icon}
                    size="md"
                    color={action.destructive ? 'error' : 'default'}
                  />
                ) : null}
                <Text variant="body" color={action.destructive ? 'error' : 'textPrimary'}>
                  {action.label}
                </Text>
              </Pressable>
              {index < actions.length - 1 ? <Divider /> : null}
            </Box>
          ))}
          <Divider inset />
          <Pressable
            onPress={onCancel}
            accessibilityRole="button"
            accessibilityLabel={resolvedCancel}
            style={{ paddingVertical: theme.spacing[12], alignItems: 'center' }}>
            <Text variant="button" color="textSecondary">
              {resolvedCancel}
            </Text>
          </Pressable>
        </Box>
      </BottomSheet>
    );
  }),
);
