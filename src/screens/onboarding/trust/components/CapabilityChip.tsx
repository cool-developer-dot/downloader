import { memo, type ComponentType } from 'react';
import { StyleSheet, Text, View } from 'react-native';
import {
  Bell,
  Download,
  ListOrdered,
  Pause,
  Play,
  RotateCcw,
} from 'lucide-react-native';
import Animated, { useAnimatedStyle } from 'react-native-reanimated';

import { fontFamilies } from '@/theme/typography';

import { useOnboardingSurfaces } from '../../onboarding-surfaces-context';
import type { TrustChipAnim } from '../animations/useTrustSequence';
import { TRUST_LAYOUT, type TrustCapabilityId } from '../constants';

type ChipIconProps = {
  size?: number;
  color?: string;
  strokeWidth?: number;
};

const CHIP_ICONS: Record<TrustCapabilityId, ComponentType<ChipIconProps>> = {
  pause: Pause,
  resume: Play,
  queue: ListOrdered,
  notifications: Bell,
  retry: RotateCcw,
  background: Download,
};

type CapabilityChipProps = {
  id: TrustCapabilityId;
  label: string;
  anim: TrustChipAnim;
};

export const CapabilityChip = memo(function CapabilityChip({
  id,
  label,
  anim,
}: CapabilityChipProps) {
  const surfaces = useOnboardingSurfaces();
  const Icon = CHIP_ICONS[id];

  const style = useAnimatedStyle(() => ({
    opacity: anim.opacity.value,
    transform: [
      { translateY: anim.translateY.value + anim.floatY.value },
      { scale: anim.scale.value },
    ],
  }));

  return (
    <Animated.View
      style={[
        styles.chip,
        {
          borderColor: surfaces.chipBorder,
          backgroundColor: surfaces.chipBg,
        },
        style,
      ]}
      accessibilityLabel={label}
      accessible
      accessibilityRole="text">
      <View style={styles.inner}>
        <Icon size={14} color={surfaces.chipIcon} strokeWidth={2} />
        <Text
          style={[
            styles.label,
            { fontFamily: fontFamilies.body, color: surfaces.chipText },
          ]}
          maxFontSizeMultiplier={TRUST_LAYOUT.maxFontMultiplier}
          numberOfLines={1}>
          {label}
        </Text>
      </View>
    </Animated.View>
  );
});

const styles = StyleSheet.create({
  chip: {
    height: TRUST_LAYOUT.chipHeight,
    borderRadius: TRUST_LAYOUT.chipHeight / 2,
    borderWidth: StyleSheet.hairlineWidth + 0.5,
    paddingHorizontal: 14,
    justifyContent: 'center',
  },
  inner: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 7,
  },
  label: {
    fontSize: 12,
    letterSpacing: 0.2,
  },
});
