import { Image } from 'expo-image';
import { memo, useState } from 'react';
import { StyleSheet, View } from 'react-native';
import Svg, { Defs, LinearGradient, Rect, Stop } from 'react-native-svg';

import { useSettingsStore } from '@/store/settings';

import {
  resolveStartPageBackground,
  START_PAGE_DARK_LAYER_OPACITY,
  type StartPageBackground,
} from '../start-page-background';

/** B21 #245: the start page background the settings ask for (`theme` = none). */
export function useStartPageBackground(): StartPageBackground {
  const kind = useSettingsStore((s) => s.startPageBackground);
  const color = useSettingsStore((s) => s.startPageBackgroundColor);
  const gradient = useSettingsStore((s) => s.startPageBackgroundGradient);
  const photo = useSettingsStore((s) => s.startPageBackgroundPhoto);
  return resolveStartPageBackground({ kind, color, gradient, photo });
}

/**
 * B21 #245 — drawn behind the start page: a colour, a top-to-bottom gradient or the user's photo (from the app's own
 * storage), with a dark layer over it so the start page's (dark-palette) text stays readable. Hidden from screen
 * readers: it is decoration.
 */
export const StartPageBackdrop = memo(function StartPageBackdrop({
  background,
  testID = 'start-page-backdrop',
}: {
  background: Exclude<StartPageBackground, { kind: 'theme' }>;
  testID?: string;
}) {
  const [photoFailed, setPhotoFailed] = useState(false);

  return (
    <View
      testID={testID}
      pointerEvents="none"
      importantForAccessibility="no-hide-descendants"
      accessibilityElementsHidden
      style={[StyleSheet.absoluteFill, { backgroundColor: background.kind === 'color' ? background.color : '#111827' }]}>
      {background.kind === 'gradient' ? (
        <Svg width="100%" height="100%">
          <Defs>
            <LinearGradient id="startPageGradient" x1="0" y1="0" x2="0" y2="1">
              <Stop offset="0" stopColor={background.colors[0]} />
              <Stop offset="1" stopColor={background.colors[1]} />
            </LinearGradient>
          </Defs>
          <Rect x="0" y="0" width="100%" height="100%" fill="url(#startPageGradient)" />
        </Svg>
      ) : null}
      {background.kind === 'photo' && !photoFailed ? (
        <Image
          source={{ uri: background.uri }}
          style={StyleSheet.absoluteFill}
          contentFit="cover"
          onError={() => setPhotoFailed(true)}
          accessibilityIgnoresInvertColors
        />
      ) : null}
      <View style={[StyleSheet.absoluteFill, { backgroundColor: `rgba(0,0,0,${START_PAGE_DARK_LAYER_OPACITY})` }]} />
    </View>
  );
});
