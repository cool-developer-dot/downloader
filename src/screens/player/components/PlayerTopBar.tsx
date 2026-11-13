import { memo } from 'react';
import { StyleSheet, View } from 'react-native';

import { Box } from '@/components/base/Box';
import { Text } from '@/components/base/Text';
import { IconButton } from '@/components/buttons/IconButton';
import { useTranslation } from '@/localization';

export type PlayerTopBarProps = {
  title: string;
  /** The artist VidoraX keeps for the item (Edit after download → Title & artist); nothing when there is none. */
  artist?: string | null;
  isFullscreen: boolean;
  visible: boolean;
  orientationIcon: string;
  onBack: () => void;
  onOpenOrientation: () => void;
  onToggleFullscreen: () => void;
  /** A file opened from another app: "Save to VidoraX". Omitted for library videos. */
  save?: {
    state: 'idle' | 'saving' | 'saved';
    onPress: () => void;
  } | null;
};

export const PlayerTopBar = memo(function PlayerTopBar({
  title,
  artist,
  isFullscreen,
  visible,
  orientationIcon,
  onBack,
  onOpenOrientation,
  onToggleFullscreen,
  save = null,
}: PlayerTopBarProps) {
  const { t, rtl } = useTranslation();
  if (!visible) {
    return null;
  }

  return (
    <View
      pointerEvents="box-none"
      style={[styles.wrap, isFullscreen ? styles.fullscreen : null]}>
      <Box row style={styles.row}>
        <IconButton
          icon={rtl.arrowBack}
          size="medium"
          variant="ghost"
          color="inverse"
          accessibilityLabel={isFullscreen ? t('player.exitFullscreen') : t('player.goBack')}
          onPress={onBack}
        />
        <Text
          variant="bodySmall"
          color="white"
          numberOfLines={1}
          style={styles.title}>
          {title}
        </Text>
        {artist ? (
          <Text variant="caption" color="white" numberOfLines={1} style={styles.artist}>
            {artist}
          </Text>
        ) : null}
        {save ? (
          <IconButton
            icon={save.state === 'saved' ? 'check-circle-outline' : 'content-save-outline'}
            size="medium"
            variant="ghost"
            color="inverse"
            disabled={save.state !== 'idle'}
            accessibilityLabel={
              save.state === 'saved'
                ? t('player.savedToLibrary')
                : save.state === 'saving'
                  ? t('player.savingToLibrary')
                  : t('player.saveToLibrary')
            }
            accessibilityHint={save.state === 'idle' ? t('player.saveToLibraryHint') : undefined}
            onPress={save.onPress}
            testID="player-save-to-library"
          />
        ) : null}
        <IconButton
          icon={orientationIcon}
          size="medium"
          variant="ghost"
          color="inverse"
          accessibilityLabel={t('player.orientationTitle')}
          onPress={onOpenOrientation}
        />
        <IconButton
          icon={isFullscreen ? 'fullscreen-exit' : 'fullscreen'}
          size="medium"
          variant="ghost"
          color="inverse"
          accessibilityLabel={
            isFullscreen ? t('player.exitFullscreen') : t('player.enterFullscreen')
          }
          onPress={onToggleFullscreen}
        />
      </Box>
    </View>
  );
});

const styles = StyleSheet.create({
  wrap: {
    position: 'absolute',
    top: 0,
    left: 0,
    right: 0,
    zIndex: 4,
    paddingTop: 4,
    paddingBottom: 8,
    backgroundColor: 'rgba(0,0,0,0.45)',
  },
  fullscreen: {
    paddingTop: 8,
  },
  row: {
    alignItems: 'center',
    paddingHorizontal: 4,
  },
  title: {
    flex: 1,
    marginHorizontal: 8,
  },
  artist: {
    maxWidth: '35%',
    marginEnd: 8,
    opacity: 0.8,
  },
});
