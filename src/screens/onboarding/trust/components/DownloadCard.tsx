import { memo } from 'react';
import { StyleSheet, Text, View } from 'react-native';
import Animated, { type SharedValue, useAnimatedStyle } from 'react-native-reanimated';

import { fontFamilies } from '@/theme/typography';

import { useOnboardingSurfaces } from '../../onboarding-surfaces-context';
import { TRUST_LAYOUT, TRUST_WORKFLOW } from '../constants';

import { ProgressTimeline } from './ProgressTimeline';

type DownloadCardProps = {
  opacity: SharedValue<number>;
  scale: SharedValue<number>;
  breath: SharedValue<number>;
  translateY: SharedValue<number>;
  progress: SharedValue<number>;
  progressOpacity: SharedValue<number>;
  completedOpacity: SharedValue<number>;
  width: number;
};

/**
 * Glass download card — title, meta, and living progress rail.
 */
export const DownloadCard = memo(function DownloadCard({
  opacity,
  scale,
  breath,
  translateY,
  progress,
  progressOpacity,
  completedOpacity,
  width,
}: DownloadCardProps) {
  const surfaces = useOnboardingSurfaces();
  const style = useAnimatedStyle(() => ({
    opacity: opacity.value,
    transform: [
      { translateY: translateY.value },
      { scale: scale.value * breath.value },
    ],
  }));

  return (
    <Animated.View
      style={[
        styles.card,
        {
          width,
          borderColor: surfaces.glassBorder,
          backgroundColor: surfaces.glassBg,
        },
        style,
      ]}
      accessibilityLabel={`${TRUST_WORKFLOW.cardTitle}. ${TRUST_WORKFLOW.quality}. ${TRUST_WORKFLOW.format}. ${TRUST_WORKFLOW.size}`}>
      <View style={styles.header}>
        <View
          style={[
            styles.thumb,
            {
              backgroundColor: surfaces.accentSoft,
              borderColor: surfaces.glassBorderActive,
            },
          ]}>
          <View
            style={[
              styles.thumbAccent,
              {
                backgroundColor: surfaces.accentSoft,
                borderColor: surfaces.glassBorderActive,
              },
            ]}
          />
        </View>
        <View style={styles.meta}>
          <Text
            style={[
              styles.title,
              { fontFamily: fontFamilies.bodySemiBold, color: surfaces.softWhite },
            ]}
            maxFontSizeMultiplier={TRUST_LAYOUT.maxFontMultiplier}
            numberOfLines={1}>
            {TRUST_WORKFLOW.cardTitle}
          </Text>
          <Text
            style={[
              styles.details,
              { fontFamily: fontFamilies.body, color: surfaces.muted },
            ]}
            maxFontSizeMultiplier={TRUST_LAYOUT.maxFontMultiplier}
            numberOfLines={1}>
            {TRUST_WORKFLOW.quality}
            <Text style={styles.dot}>  ·  </Text>
            {TRUST_WORKFLOW.format}
            <Text style={styles.dot}>  ·  </Text>
            {TRUST_WORKFLOW.size}
          </Text>
        </View>
      </View>

      <ProgressTimeline
        progress={progress}
        progressOpacity={progressOpacity}
        completedOpacity={completedOpacity}
      />
    </Animated.View>
  );
});

const styles = StyleSheet.create({
  card: {
    marginTop: 18,
    borderRadius: 18,
    borderWidth: StyleSheet.hairlineWidth + 0.5,
    paddingHorizontal: 16,
    paddingTop: 14,
    paddingBottom: 14,
    maxWidth: TRUST_LAYOUT.cardMaxWidth,
  },
  header: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 12,
  },
  thumb: {
    width: 42,
    height: 42,
    borderRadius: 10,
    borderWidth: StyleSheet.hairlineWidth,
    alignItems: 'center',
    justifyContent: 'center',
    overflow: 'hidden',
  },
  thumbAccent: {
    width: 16,
    height: 16,
    borderRadius: 4,
    borderWidth: StyleSheet.hairlineWidth,
  },
  meta: {
    flex: 1,
    gap: 4,
  },
  title: {
    fontSize: 15,
    letterSpacing: 0.15,
  },
  details: {
    fontSize: 12,
    letterSpacing: 0.2,
  },
  dot: {
    color: 'rgba(148, 163, 184, 0.35)',
  },
});
