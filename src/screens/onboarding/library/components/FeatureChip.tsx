import { memo, type ComponentType } from 'react';
import { StyleSheet, Text, View } from 'react-native';
import Clock3 from 'lucide-react-native/icons/clock-3';
import FolderOpen from 'lucide-react-native/icons/folder-open';
import Heart from 'lucide-react-native/icons/heart';
import Play from 'lucide-react-native/icons/play';
import Search from 'lucide-react-native/icons/search';
import Settings from 'lucide-react-native/icons/settings';
import Animated, { type SharedValue, useAnimatedStyle } from 'react-native-reanimated';

import { useTranslation, type TranslationKey } from '@/localization';
import { fontFamilies } from '@/theme/typography';

import { useOnboardingSurfaces } from '../../onboarding-surfaces-context';
import type { LibraryChipAnim } from '../animations/useLibrarySequence';
import { LIBRARY_LAYOUT, type LibraryFeature } from '../constants';

type ChipIconProps = {
  size?: number;
  color?: string;
  strokeWidth?: number;
};

const FEATURE_LABEL_KEYS: Record<LibraryFeature['id'], TranslationKey> = {
  favorites: 'onboarding.libraryFavorites',
  history: 'onboarding.libraryHistory',
  search: 'onboarding.librarySearch',
  player: 'onboarding.libraryPlayer',
  library: 'onboarding.libraryOrganized',
  settings: 'onboarding.librarySettings',
};

const FEATURE_ICONS: Record<LibraryFeature['id'], ComponentType<ChipIconProps>> = {
  favorites: Heart,
  history: Clock3,
  search: Search,
  player: Play,
  library: FolderOpen,
  settings: Settings,
};

/** Approximate half-widths so chips stay centered on their orbit points. */
const CHIP_HALF_WIDTH: Record<LibraryFeature['id'], number> = {
  favorites: 52,
  history: 48,
  search: 62,
  player: 68,
  library: 78,
  settings: 48,
};

type FeatureChipProps = {
  feature: LibraryFeature;
  anim: LibraryChipAnim;
  converge: SharedValue<number>;
  center: number;
};

/**
 * Glass capability capsule — floats, then settles into the hub.
 */
export const FeatureChip = memo(function FeatureChip({
  feature,
  anim,
  converge,
  center,
}: FeatureChipProps) {
  const { t } = useTranslation();
  const surfaces = useOnboardingSurfaces();
  const label = t(FEATURE_LABEL_KEYS[feature.id]);
  const Icon = FEATURE_ICONS[feature.id];
  const halfW = CHIP_HALF_WIDTH[feature.id];
  const halfH = LIBRARY_LAYOUT.chipHeight / 2;

  const style = useAnimatedStyle(() => {
    const x = feature.scatter.x + (feature.dash.x - feature.scatter.x) * converge.value;
    const y = feature.scatter.y + (feature.dash.y - feature.scatter.y) * converge.value;

    return {
      opacity: anim.opacity.value,
      transform: [
        { translateX: center + x - halfW },
        {
          translateY:
            center + y + anim.translateY.value + anim.floatY.value - halfH,
        },
        { scale: anim.scale.value * (1 - converge.value * 0.04) },
      ],
    };
  });

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
        <Icon size={13} color={surfaces.chipIcon} strokeWidth={2} />
        <Text
          style={[
            styles.label,
            { fontFamily: fontFamilies.body, color: surfaces.chipText },
          ]}
          maxFontSizeMultiplier={LIBRARY_LAYOUT.maxFontMultiplier}
          numberOfLines={1}>
          {label}
        </Text>
      </View>
    </Animated.View>
  );
});

const styles = StyleSheet.create({
  chip: {
    position: 'absolute',
    height: LIBRARY_LAYOUT.chipHeight,
    borderRadius: LIBRARY_LAYOUT.chipHeight / 2,
    borderWidth: StyleSheet.hairlineWidth + 0.5,
    paddingHorizontal: 12,
    justifyContent: 'center',
    zIndex: 4,
  },
  inner: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 6,
  },
  label: {
    fontSize: 11,
    letterSpacing: 0.15,
  },
});
