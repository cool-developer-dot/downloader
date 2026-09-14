import { memo } from 'react';
import Animated, { type SharedValue, useAnimatedStyle } from 'react-native-reanimated';

import { fontFamilies } from '@/theme/typography';

import { useOnboardingSurfaces } from '../../onboarding-surfaces-context';
import { TRUST_LAYOUT, TRUST_WORKFLOW } from '../constants';
import { trustStyles } from '../styles';

type OfflineLibraryProps = {
  opacity: SharedValue<number>;
  glow: SharedValue<number>;
};

/**
 * Soft destination shelf — illuminates as the download card lands.
 */
export const OfflineLibrary = memo(function OfflineLibrary({
  opacity,
  glow,
}: OfflineLibraryProps) {
  const surfaces = useOnboardingSurfaces();

  const style = useAnimatedStyle(() => ({
    opacity: opacity.value,
    borderColor:
      glow.value > 0.5 ? surfaces.glassBorderActive : surfaces.libraryBorder,
    transform: [{ scale: 0.985 + glow.value * 0.015 }],
  }));

  const labelStyle = useAnimatedStyle(() => ({
    opacity: 0.55 + glow.value * 0.45,
  }));

  return (
    <Animated.View
      style={[
        trustStyles.libraryZone,
        { backgroundColor: surfaces.libraryBg },
        style,
      ]}
      accessibilityLabel={TRUST_WORKFLOW.libraryLabel}>
      <Animated.Text
        style={[
          trustStyles.libraryLabel,
          {
            fontFamily: fontFamilies.bodySemiBold,
            color: surfaces.libraryLabelActive,
          },
          labelStyle,
        ]}
        maxFontSizeMultiplier={TRUST_LAYOUT.maxFontMultiplier}>
        {TRUST_WORKFLOW.libraryLabel}
      </Animated.Text>
    </Animated.View>
  );
});
