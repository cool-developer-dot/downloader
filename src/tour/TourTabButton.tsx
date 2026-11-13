import { type BottomTabBarButtonProps } from 'expo-router/js-tabs';
import { PlatformPressable } from 'expo-router/react-navigation';
import { View } from 'react-native';

import { useTourTargetRef, type TourTargetId } from './tour-targets';

/** The default tab button, registered as a tour target so the tour can point at the real tab. */
export function TourTabButton({ tourTarget, ...props }: BottomTabBarButtonProps & { tourTarget: TourTargetId }) {
  const ref = useTourTargetRef(tourTarget);
  return (
    <View ref={ref} collapsable={false} style={{ flex: 1 }}>
      <PlatformPressable {...props} />
    </View>
  );
}

/**
 * For `tabBarButton`: React Navigation calls it as a plain function, so it returns an element (hooks live in
 * TourTabButton, a real component).
 */
export function tourTabBarButton(tourTarget: TourTargetId) {
  return function renderTourTabBarButton(props: BottomTabBarButtonProps) {
    return <TourTabButton {...props} tourTarget={tourTarget} />;
  };
}
