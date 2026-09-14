import { memo } from 'react';
import { StyleSheet, Text, View } from 'react-native';
import { Check } from 'lucide-react-native';
import Animated, { type SharedValue, useAnimatedStyle } from 'react-native-reanimated';

import { useTranslation } from '@/localization';
import { fontFamilies } from '@/theme/typography';

import { useOnboardingSurfaces } from '../../onboarding-surfaces-context';
import { TRUST_LAYOUT, TRUST_WORKFLOW } from '../constants';

type ProgressTimelineProps = {
  progress: SharedValue<number>;
  progressOpacity: SharedValue<number>;
  completedOpacity: SharedValue<number>;
};

/**
 * Premium 2.5px progress rail that morphs into "Completed ✓".
 * Fill width is continuously interpolated — never jumps.
 */
export const ProgressTimeline = memo(function ProgressTimeline({
  progress,
  progressOpacity,
  completedOpacity,
}: ProgressTimelineProps) {
  const { t } = useTranslation();
  const surfaces = useOnboardingSurfaces();

  const fillStyle = useAnimatedStyle(() => ({
    width: `${Math.min(Math.max(progress.value, 0), 1) * 100}%`,
  }));

  const railStyle = useAnimatedStyle(() => ({
    opacity: progressOpacity.value,
  }));

  const doneStyle = useAnimatedStyle(() => ({
    opacity: completedOpacity.value,
    transform: [{ scale: 0.98 + completedOpacity.value * 0.02 }],
  }));

  return (
    <View
      style={styles.root}
      accessibilityRole="progressbar"
      accessibilityLabel={t('onboarding.progressA11y')}>
      <Animated.View style={[styles.railWrap, railStyle]}>
        <View style={[styles.track, { backgroundColor: surfaces.progressTrack }]}>
          <Animated.View
            style={[styles.fill, { backgroundColor: surfaces.accent }, fillStyle]}
          />
        </View>
      </Animated.View>

      <Animated.View style={[styles.completed, doneStyle]} pointerEvents="none">
        <Text
          style={[
            styles.completedText,
            { fontFamily: fontFamilies.bodySemiBold, color: surfaces.softWhite },
          ]}
          maxFontSizeMultiplier={TRUST_LAYOUT.maxFontMultiplier}>
          {TRUST_WORKFLOW.completedLabel}
        </Text>
        <View
          style={[
            styles.checkBadge,
            {
              backgroundColor: surfaces.accentSoft,
              borderColor: surfaces.glassBorderActive,
            },
          ]}>
          <Check size={12} color={surfaces.accent} strokeWidth={2.5} />
        </View>
      </Animated.View>
    </View>
  );
});

const styles = StyleSheet.create({
  root: {
    marginTop: 14,
    minHeight: 22,
    justifyContent: 'center',
  },
  railWrap: {
    justifyContent: 'center',
  },
  track: {
    height: TRUST_LAYOUT.progressHeight,
    borderRadius: TRUST_LAYOUT.progressHeight,
    overflow: 'hidden',
  },
  fill: {
    height: '100%',
    borderRadius: TRUST_LAYOUT.progressHeight,
  },
  completed: {
    ...StyleSheet.absoluteFill,
    flexDirection: 'row',
    alignItems: 'center',
    gap: 8,
  },
  completedText: {
    fontSize: 13,
    letterSpacing: 0.3,
  },
  checkBadge: {
    width: 20,
    height: 20,
    borderRadius: 10,
    alignItems: 'center',
    justifyContent: 'center',
    borderWidth: StyleSheet.hairlineWidth,
  },
});
