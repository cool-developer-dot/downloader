import { BottomTabBar, type BottomTabBarProps } from 'expo-router/js-tabs';
import { View } from 'react-native';

import { MiniPlayer } from './MiniPlayer';

/**
 * The tab bar with the mini player docked on top of it: part of the bar's own layout, so tab screens end above it
 * (nothing of theirs is covered) and the tabs themselves stay free.
 */
export function MiniPlayerTabBar(props: BottomTabBarProps) {
  return (
    <View>
      <MiniPlayer placement="dock" />
      <BottomTabBar {...props} />
    </View>
  );
}

/**
 * For `Tabs tabBar`: React Navigation calls it as a plain function (inside a context consumer), so it must return an
 * element rather than be the component itself — the React Compiler gives components a hook, which is invalid there.
 */
export function renderMiniPlayerTabBar(props: BottomTabBarProps) {
  return <MiniPlayerTabBar {...props} />;
}
