import { memo, type PropsWithChildren, type ReactNode } from 'react';
import { Modal, type StyleProp, type ViewStyle } from 'react-native';
import { Portal } from 'react-native-paper';

import { Box } from '@/components/base/Box';
import { IconButton } from '@/components/buttons/IconButton';
import { Text } from '@/components/base/Text';
import { useTheme } from '@/hooks/use-theme';
import { useTranslation } from '@/localization';

export type AppModalProps = PropsWithChildren<{
  visible: boolean;
  title?: string;
  subtitle?: string;
  onClose?: () => void;
  showCloseButton?: boolean;
  footer?: ReactNode;
  style?: StyleProp<ViewStyle>;
  testID?: string;
}>;

export const AppModal = memo(function AppModal({
  visible,
  title,
  subtitle,
  onClose,
  showCloseButton = true,
  footer,
  children,
  style,
  testID,
}: AppModalProps) {
  const theme = useTheme();
  const { t } = useTranslation();

  // Unmount when dismissed — Android transparent Modal can keep a touch
  // interceptor after visible=false.
  if (!visible) {
    return null;
  }

  return (
    <Portal>
      <Modal
        visible
        transparent
        animationType="fade"
        onRequestClose={onClose}
        testID={testID}>
        <Box flex={1} center p={24} style={{ backgroundColor: theme.colors.overlay }}>
          <Box
            gap={16}
            p={24}
            borderRadius="lg"
            backgroundColor="card"
            style={[theme.elevation.lg, { width: '100%', maxWidth: 420 }, style as ViewStyle | undefined]}>
            <Box row center gap={12}>
              <Box flex={1} gap={4}>
                {title ? <Text variant="title">{title}</Text> : null}
                {subtitle ? (
                  <Text variant="bodySmall" color="textSecondary">
                    {subtitle}
                  </Text>
                ) : null}
              </Box>
              {showCloseButton && onClose ? (
                <IconButton icon="close" accessibilityLabel={t('common.closeModal')} onPress={onClose} variant="ghost" />
              ) : null}
            </Box>
            {children}
            {footer}
          </Box>
        </Box>
      </Modal>
    </Portal>
  );
});
