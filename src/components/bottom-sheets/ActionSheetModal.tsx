import { memo, useCallback } from 'react';
import { Modal, Pressable as RNPressable, StyleSheet, View } from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';

import { Box } from '@/components/base/Box';
import { Icon } from '@/components/base/Icon';
import { Pressable } from '@/components/base/Pressable';
import { Text } from '@/components/base/Text';
import { Divider } from '@/components/common/Divider';
import { useTheme } from '@/hooks/use-theme';
import { useTranslation } from '@/localization';

import type { ActionSheetItem } from './ActionSheet';

export type ActionSheetModalProps = {
  visible: boolean;
  actions: ActionSheetItem[];
  title?: string;
  subtitle?: string;
  cancelLabel?: string;
  onClose: () => void;
  testID?: string;
};

/**
 * Controlled action sheet using RN Modal.
 *
 * Prefer this over gorhom BottomSheetModal for critical link/settings sheets:
 * emulator / accessibility "reduced motion" can leave BottomSheetModal stuck closed.
 */
export const ActionSheetModal = memo(function ActionSheetModal({
  visible,
  actions,
  title,
  subtitle,
  cancelLabel,
  onClose,
  testID,
}: ActionSheetModalProps) {
  const theme = useTheme();
  const insets = useSafeAreaInsets();
  const { t, rtl } = useTranslation();
  const resolvedCancel = cancelLabel ?? t('common.cancel');

  const handleActionPress = useCallback(
    (action: ActionSheetItem) => {
      onClose();
      action.onPress?.();
    },
    [onClose],
  );

  // Unmount when dismissed — Android transparent Modal can keep intercepting
  // touches after visible=false (dead buttons after overflow / Video available).
  if (!visible) {
    return null;
  }

  return (
    <Modal
      visible
      transparent
      animationType="fade"
      onRequestClose={onClose}
      statusBarTranslucent>
      <View style={styles.root} testID={testID ? `${testID}-root` : undefined}>
        <RNPressable
          accessibilityRole="button"
          accessibilityLabel={t('common.dismiss')}
          onPress={onClose}
          style={[styles.backdrop, { backgroundColor: `rgba(0,0,0,${theme.opacity.overlay})` }]}
        />
        <View
          testID={testID}
          style={[
            styles.sheet,
            {
              backgroundColor: theme.colors.card,
              borderTopLeftRadius: theme.radius.xl,
              borderTopRightRadius: theme.radius.xl,
              paddingBottom: insets.bottom + 16,
            },
          ]}>
          <View style={[styles.handle, { backgroundColor: theme.colors.border }]} />

          {title || subtitle ? (
            <Box gap={4} mb={12} px={16}>
              {title ? <Text variant="title">{title}</Text> : null}
              {subtitle ? (
                <Text variant="bodySmall" color="textSecondary">
                  {subtitle}
                </Text>
              ) : null}
            </Box>
          ) : null}

          <Box gap={4} px={16}>
            {actions.map((action, index) => (
              <Box key={action.id} gap={4}>
                <Pressable
                  onPress={() => handleActionPress(action)}
                  accessibilityRole="button"
                  accessibilityLabel={
                    action.selected
                      ? t('settings.languageSelected', { label: action.label })
                      : action.label
                  }
                  accessibilityState={{ selected: action.selected === true }}
                  testID={testID ? `${testID}-${action.id}` : undefined}
                  style={{
                    flexDirection: rtl.rowDirection,
                    alignItems: 'center',
                    gap: theme.spacing[12],
                    paddingVertical: theme.spacing[16],
                  }}>
                  {action.icon ? (
                    <Icon
                      name={action.icon}
                      size="md"
                      color={action.destructive ? 'error' : 'default'}
                    />
                  ) : null}
                  <Text
                    variant="body"
                    color={
                      action.destructive
                        ? 'error'
                        : action.selected
                          ? 'primary'
                          : 'textPrimary'
                    }>
                    {action.selected ? `✓ ${action.label}` : action.label}
                  </Text>
                </Pressable>
                {index < actions.length - 1 ? <Divider /> : null}
              </Box>
            ))}

            <Divider inset />

            <Pressable
              onPress={onClose}
              accessibilityRole="button"
              accessibilityLabel={resolvedCancel}
              testID={testID ? `${testID}-cancel` : undefined}
              style={{
                paddingVertical: theme.spacing[16],
                alignItems: 'center',
              }}>
              <Text variant="button" color="textSecondary">
                {resolvedCancel}
              </Text>
            </Pressable>
          </Box>
        </View>
      </View>
    </Modal>
  );
});

const styles = StyleSheet.create({
  root: {
    flex: 1,
    justifyContent: 'flex-end',
  },
  backdrop: {
    ...StyleSheet.absoluteFill,
  },
  sheet: {
    paddingTop: 8,
    maxHeight: '70%',
  },
  handle: {
    alignSelf: 'center',
    width: 40,
    height: 4,
    borderRadius: 2,
    marginBottom: 8,
  },
});
