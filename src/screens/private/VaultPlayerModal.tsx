import { useVideoPlayer, VideoView } from 'expo-video';
import { memo } from 'react';
import { ActivityIndicator, Modal, View } from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';

import { Icon } from '@/components/base/Icon';
import { Pressable } from '@/components/base/Pressable';
import { Text } from '@/components/base/Text';
import { useTheme } from '@/hooks/use-theme';
import { useTranslation } from '@/localization';

export type VaultPlayerModalProps = {
  /** The decrypted temporary file while playing; null while it is being prepared. */
  uri: string | null;
  preparing: boolean;
  /** "45%" while a large video is being decrypted. */
  percent: string | null;
  onClose: () => void;
};

/**
 * Plays a private video (#459) in its own player — not the app's Player — so nothing about it is recorded: no
 * position, no Watch History, no Continue Watching, no mini player, no picture-in-picture, no media notification.
 * Closing it deletes the decrypted file (the caller does that on close).
 */
export const VaultPlayerModal = memo(function VaultPlayerModal({ uri, preparing, percent, onClose }: VaultPlayerModalProps) {
  const theme = useTheme();
  const { t } = useTranslation();
  const insets = useSafeAreaInsets();
  const visible = preparing || uri !== null;

  return (
    <Modal visible={visible} animationType="fade" onRequestClose={onClose} statusBarTranslucent supportedOrientations={['portrait', 'landscape']}>
      <View style={{ flex: 1, backgroundColor: theme.colors.black }} testID="private-player">
        {uri ? (
          <VaultVideo uri={uri} />
        ) : (
          <View style={{ flex: 1, alignItems: 'center', justifyContent: 'center', gap: 12 }}>
            <ActivityIndicator color={theme.colors.white} />
            <Text variant="body" style={{ color: theme.colors.white }} accessibilityLiveRegion="polite">
              {percent ? t('privateVault.preparingProgress', { percent }) : t('privateVault.preparing')}
            </Text>
          </View>
        )}
        <Pressable
          onPress={onClose}
          accessibilityRole="button"
          accessibilityLabel={t('common.close')}
          hitSlop={12}
          style={{ position: 'absolute', top: insets.top + 8, start: 12, padding: 8 }}
          testID="private-player-close">
          <Icon name="close" size="md" color="inverse" />
        </Pressable>
      </View>
    </Modal>
  );
});

/** Mounted only with a file to play; expo-video releases the player when it unmounts. */
function VaultVideo({ uri }: { uri: string }) {
  const player = useVideoPlayer({ uri, useCaching: false }, (created) => {
    created.loop = false;
    created.staysActiveInBackground = false;
    created.showNowPlayingNotification = false;
    created.play();
  });
  return (
    <VideoView
      player={player}
      style={{ flex: 1 }}
      nativeControls
      contentFit="contain"
      allowsPictureInPicture={false}
      startsPictureInPictureAutomatically={false}
      fullscreenOptions={{ enable: false }}
      testID="private-player-video"
    />
  );
}
