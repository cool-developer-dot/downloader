import { useSegments } from 'expo-router';
import { memo } from 'react';
import { StyleSheet, View } from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';

import { MiniPlayer } from './MiniPlayer';

/** Widest the floating card gets (tablets): it sits at the end edge instead of spanning the screen. */
const FLOATING_MAX_WIDTH = 480;

/**
 * The mini player over the app's other screens (Watch history, Download details, Settings pages…): a floating card at
 * the bottom. On the tabs it is docked in the tab bar instead (MiniPlayerTabBar); on the Player it never shows.
 */
export const MiniPlayerOverlay = memo(function MiniPlayerOverlay() {
  const segments = useSegments() as string[];
  const insets = useSafeAreaInsets();
  const route = segments[1];
  if (route === '(tabs)' || route === 'player' || route == null) {
    return null;
  }
  return (
    <View
      pointerEvents="box-none"
      style={[styles.overlay, { paddingBottom: insets.bottom + 8, paddingStart: insets.left + 8, paddingEnd: insets.right + 8 }]}>
      <View style={styles.slot}>
        <MiniPlayer placement="floating" />
      </View>
    </View>
  );
});

const styles = StyleSheet.create({
  overlay: {
    position: 'absolute',
    left: 0,
    right: 0,
    bottom: 0,
    alignItems: 'flex-end',
  },
  slot: {
    width: '100%',
    maxWidth: FLOATING_MAX_WIDTH,
  },
});
