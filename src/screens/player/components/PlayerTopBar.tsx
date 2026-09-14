import { memo } from 'react';
import { StyleSheet, View } from 'react-native';

import { Box } from '@/components/base/Box';
import { Text } from '@/components/base/Text';
import { IconButton } from '@/components/buttons/IconButton';
import { useTranslation } from '@/localization';

export type PlayerTopBarProps = {
  title: string;
  isFullscreen: boolean;
  visible: boolean;
  orientationIcon: string;
  onBack: () => void;
  onOpenOrientation: () => void;
  onToggleFullscreen: () => void;
};

export const PlayerTopBar = memo(function PlayerTopBar({
  title,
  isFullscreen,
  visible,
  orientationIcon,
  onBack,
  onOpenOrientation,
  onToggleFullscreen,
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
});
