import { memo, useState } from 'react';
import { Modal, Pressable as RNPressable, StyleSheet, useWindowDimensions, View } from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';

import { Box } from '@/components/base/Box';
import { Pressable } from '@/components/base/Pressable';
import { Text } from '@/components/base/Text';
import { TextField } from '@/components/inputs/TextField';
import { useKeyboardHeight } from '@/hooks/use-keyboard-height';
import { useTheme } from '@/hooks/use-theme';
import { useTranslation } from '@/localization';
import { formatJumpTime, formatPlaybackTime, parseJumpTime } from '@/player';
import { useTourBlocker } from '@/tour/tour-store';

export type JumpToTimeSheetProps = {
  visible: boolean;
  /** Where the video is now: the field starts there. */
  positionSeconds: number;
  durationSeconds: number | null;
  onJump: (seconds: number) => void;
  onClose: () => void;
};

/**
 * P1 #532 Jump to Time: type 1:24 or 1:02:03 (Urdu digits work too) and go there. A time that can't be read or lies
 * past the end is explained under the field; the sheet stays open.
 */
export const JumpToTimeSheet = memo(function JumpToTimeSheet({
  visible,
  positionSeconds,
  durationSeconds,
  onJump,
  onClose,
}: JumpToTimeSheetProps) {
  const theme = useTheme();
  const insets = useSafeAreaInsets();
  const window = useWindowDimensions();
  const keyboardHeight = useKeyboardHeight(visible);
  const { t, rtl } = useTranslation();
  const [text, setText] = useState('');
  const [error, setError] = useState<string | null>(null);
  const [shown, setShown] = useState(false);

  // Each opening starts from the current time.
  if (visible !== shown) {
    setShown(visible);
    if (visible) {
      setText(formatJumpTime(positionSeconds));
      setError(null);
    }
  }

  useTourBlocker(visible);

  if (!visible) return null;

  const submit = () => {
    const result = parseJumpTime(text, durationSeconds);
    if (result.ok) {
      onJump(result.seconds);
      return;
    }
    setError(
      result.reason === 'empty'
        ? t('videoPlayer.jumpErrorEmpty')
        : result.reason === 'beyond'
          ? t('videoPlayer.jumpErrorBeyond', { duration: formatPlaybackTime(durationSeconds) })
          : t('videoPlayer.jumpErrorInvalid'),
    );
  };

  return (
    <Modal visible transparent animationType="fade" onRequestClose={onClose} statusBarTranslucent>
      <View style={styles.root}>
        <RNPressable
          accessibilityRole="button"
          accessibilityLabel={t('common.dismiss')}
          onPress={onClose}
          style={[StyleSheet.absoluteFill, { backgroundColor: `rgba(0,0,0,${theme.opacity.overlay})` }]}
        />
        <View
          testID="player-jump-sheet"
          style={{
            backgroundColor: theme.colors.card,
            borderTopLeftRadius: theme.radius.xl,
            borderTopRightRadius: theme.radius.xl,
            paddingTop: 8,
            paddingHorizontal: 16,
            paddingBottom: keyboardHeight > 0 ? 12 : insets.bottom + 12,
            marginBottom: keyboardHeight,
            maxHeight: keyboardHeight > 0 ? window.height - keyboardHeight - insets.top - 24 : '90%',
            gap: 12,
          }}>
          <View style={[styles.handle, { backgroundColor: theme.colors.border }]} />
          <Text variant="title" accessibilityRole="header">
            {t('videoPlayer.jumpToTime')}
          </Text>
          <TextField
            label={t('videoPlayer.jumpTimeLabel')}
            helperText={t('videoPlayer.jumpTimeHint')}
            value={text}
            onChangeText={(next) => {
              setText(next);
              if (error) setError(null);
            }}
            keyboardType="numbers-and-punctuation"
            maxLength={12}
            autoFocus
            selectTextOnFocus
            returnKeyType="go"
            onSubmitEditing={submit}
            testID="player-jump-input"
          />
          {error ? (
            <Text variant="caption" color="error" accessibilityLiveRegion="polite" testID="player-jump-error">
              {error}
            </Text>
          ) : null}
          <Box style={{ flexDirection: rtl.rowDirection, justifyContent: 'flex-end', gap: 8 }}>
            <Pressable
              accessibilityRole="button"
              accessibilityLabel={t('common.cancel')}
              onPress={onClose}
              style={styles.button}>
              <Text variant="button" color="textSecondary">
                {t('common.cancel')}
              </Text>
            </Pressable>
            <Pressable
              accessibilityRole="button"
              accessibilityLabel={t('videoPlayer.jumpGo')}
              onPress={submit}
              testID="player-jump-go"
              style={[styles.button, { backgroundColor: theme.colors.primary, borderRadius: theme.radius.md }]}>
              <Text variant="button" color="textOnPrimary">
                {t('videoPlayer.jumpGo')}
              </Text>
            </Pressable>
          </Box>
        </View>
      </View>
    </Modal>
  );
});

const styles = StyleSheet.create({
  root: { flex: 1, justifyContent: 'flex-end' },
  handle: { alignSelf: 'center', width: 40, height: 4, borderRadius: 2, marginBottom: 4 },
  button: { minHeight: 48, minWidth: 88, paddingHorizontal: 16, alignItems: 'center', justifyContent: 'center' },
});
