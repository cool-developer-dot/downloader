import { memo } from 'react';
import { Modal, Pressable, StyleSheet } from 'react-native';

import { Box } from '@/components/base/Box';
import { Text } from '@/components/base/Text';
import { Button } from '@/components/buttons/Button';
import { useTheme } from '@/hooks/use-theme';
import { useTranslation } from '@/localization';

type Props = {
  visible: boolean;
  resumeLabel: string;
  onResume: () => void;
  onStartOver: () => void;
};

export const ResumePlaybackSheet = memo(function ResumePlaybackSheet({
  visible,
  resumeLabel,
  onResume,
  onStartOver,
}: Props) {
  const theme = useTheme();
  const { t } = useTranslation();

  // Unmount when dismissed — Android transparent Modal leftover windows
  // intercept player / chrome taps after the sheet closes.
  if (!visible) {
    return null;
  }

  return (
    <Modal
      visible
      transparent
      animationType="fade"
      onRequestClose={onStartOver}
      statusBarTranslucent
    >
      <Pressable
        style={[styles.backdrop, { backgroundColor: theme.colors.overlay }]}
        onPress={onStartOver}>
        <Pressable
          style={[
            styles.card,
            {
              backgroundColor: theme.colors.surface,
              borderColor: theme.colors.border,
            },
          ]}
          onPress={(e) => e.stopPropagation()}
        >
          <Text variant="title" style={{ color: theme.colors.textPrimary }}>
            {t('player.continueWatching')}
          </Text>
          <Text
            variant="body"
            style={{ color: theme.colors.textSecondary, marginTop: 8 }}
          >
            {t('player.continueWatchingBody')}
          </Text>
          <Box style={{ marginTop: 20, gap: 10 }}>
            <Button title={resumeLabel} onPress={onResume} variant="primary" />
            <Button title={t('player.startOver')} onPress={onStartOver} variant="outline" />
          </Box>
        </Pressable>
      </Pressable>
    </Modal>
  );
});

const styles = StyleSheet.create({
  backdrop: {
    flex: 1,
    justifyContent: 'center',
    paddingHorizontal: 24,
  },
  card: {
    borderRadius: 16,
    borderWidth: StyleSheet.hairlineWidth,
    padding: 20,
  },
});
