import { memo } from 'react';
import { StyleSheet, Text, View } from 'react-native';
import { Play } from 'lucide-react-native';
import Animated, {
  interpolate,
  type SharedValue,
  useAnimatedStyle,
} from 'react-native-reanimated';

import { useTranslation, type TranslationKey } from '@/localization';
import { fontFamilies } from '@/theme/typography';

import { useOnboardingSurfaces } from '../../onboarding-surfaces-context';
import type { LibraryCardAnim } from '../animations/useLibrarySequence';
import { LIBRARY_MOTION } from '../animations/timings';
import { LIBRARY_LAYOUT, type LibraryCard } from '../constants';

import { OfflinePlayerCard } from './OfflinePlayerCard';

const CARD_TITLE_KEYS: Record<LibraryCard['id'], TranslationKey> = {
  movie: 'onboarding.libraryMovie',
  travel: 'onboarding.libraryTravel',
  react: 'onboarding.libraryCourse',
  vacation: 'onboarding.libraryVacation',
};

const CARD_META_KEYS: Partial<Record<LibraryCard['id'], TranslationKey>> = {
  movie: 'onboarding.libraryMetaCompleted',
  react: 'onboarding.libraryMetaSaved',
  vacation: 'onboarding.libraryMetaOffline',
};

type DownloadCardProps = {
  card: LibraryCard;
  anim: LibraryCardAnim;
  organize: SharedValue<number>;
  converge: SharedValue<number>;
  filterProgress: SharedValue<number>;
  playProgress: SharedValue<number>;
  playingOpacity: SharedValue<number>;
  playPulse: SharedValue<number>;
  waveform: SharedValue<number>;
  center: number;
};

/**
 * Floating media card — scatters, organizes, filters, then plays offline.
 */
export const DownloadCard = memo(function DownloadCard({
  card,
  anim,
  organize,
  converge,
  filterProgress,
  playProgress,
  playingOpacity,
  playPulse,
  waveform,
  center,
}: DownloadCardProps) {
  const { t } = useTranslation();
  const surfaces = useOnboardingSurfaces();
  const title = t(CARD_TITLE_KEYS[card.id]);
  const meta = CARD_META_KEYS[card.id] ? t(CARD_META_KEYS[card.id]!) : card.meta;
  const isMatch = card.matchesSearch;
  const halfW = LIBRARY_LAYOUT.cardWidth / 2;
  const halfH = LIBRARY_LAYOUT.cardHeight / 2;

  const style = useAnimatedStyle(() => {
    const gridX = interpolate(organize.value, [0, 1], [card.scatter.x, card.grid.x]);
    const gridY = interpolate(organize.value, [0, 1], [card.scatter.y, card.grid.y]);
    const x = interpolate(converge.value, [0, 1], [gridX, card.dash.x]);
    const y = interpolate(converge.value, [0, 1], [gridY, card.dash.y]);

    const filterScale = isMatch
      ? 1 + filterProgress.value * (LIBRARY_MOTION.highlightScale - 1)
      : 1;
    const filterOpacity = isMatch
      ? 1
      : 1 - filterProgress.value * (1 - LIBRARY_MOTION.dimOpacity);

    const playBoost = isMatch ? 1 + playProgress.value * 0.04 : 1;

    return {
      opacity: anim.opacity.value * filterOpacity,
      transform: [
        { translateX: center + x - halfW },
        {
          translateY: center + y + anim.enterY.value + anim.floatY.value - halfH,
        },
        {
          scale: anim.scale.value * filterScale * playBoost * (1 - converge.value * 0.05),
        },
      ],
      zIndex: isMatch && filterProgress.value > 0.2 ? 5 : 2,
      borderColor:
        isMatch && playProgress.value > 0.4
          ? surfaces.glassBorderActive
          : surfaces.glassBorder,
    };
  });

  const metaStyle = useAnimatedStyle(() => ({
    opacity: isMatch ? 1 - playingOpacity.value : 1,
  }));

  const playingWrapStyle = useAnimatedStyle(() => ({
    opacity: isMatch ? playingOpacity.value : 0,
  }));

  const playBtnStyle = useAnimatedStyle(() => ({
    opacity: isMatch ? playProgress.value : 0,
    transform: [{ scale: isMatch ? playPulse.value : 1 }],
  }));

  return (
    <Animated.View
      style={[styles.card, { backgroundColor: surfaces.glassBg }, style]}
      accessibilityLabel={`${title}. ${meta}`}>
      <View style={styles.row}>
        <View
          style={[
            styles.thumb,
            {
              backgroundColor: surfaces.accentSoft,
              borderColor: surfaces.glassBorderActive,
            },
          ]}>
          {isMatch ? (
            <Animated.View
              style={[
                styles.playBadge,
                { backgroundColor: surfaces.accentSoft },
                playBtnStyle,
              ]}>
              <Play
                size={11}
                color={surfaces.accent}
                strokeWidth={2.4}
                fill={surfaces.accent}
              />
            </Animated.View>
          ) : (
            <View style={[styles.thumbDot, { backgroundColor: surfaces.accentSoft }]} />
          )}
        </View>

        <View style={styles.meta}>
          <Text
            style={[
              styles.title,
              { fontFamily: fontFamilies.bodySemiBold, color: surfaces.softWhite },
            ]}
            maxFontSizeMultiplier={LIBRARY_LAYOUT.maxFontMultiplier}
            numberOfLines={1}>
            {title}
          </Text>

          <View style={styles.statusSlot}>
            <Animated.View style={metaStyle}>
              <Text
                style={[
                  styles.metaText,
                  { fontFamily: fontFamilies.body, color: surfaces.muted },
                ]}
                maxFontSizeMultiplier={LIBRARY_LAYOUT.maxFontMultiplier}
                numberOfLines={1}>
                {meta}
              </Text>
            </Animated.View>

            {isMatch ? (
              <Animated.View style={[styles.playingSlot, playingWrapStyle]} pointerEvents="none">
                <OfflinePlayerCard waveform={waveform} />
              </Animated.View>
            ) : null}
          </View>
        </View>
      </View>
    </Animated.View>
  );
});

const styles = StyleSheet.create({
  card: {
    position: 'absolute',
    width: LIBRARY_LAYOUT.cardWidth,
    minHeight: LIBRARY_LAYOUT.cardHeight,
    borderRadius: 14,
    borderWidth: StyleSheet.hairlineWidth + 0.5,
    paddingHorizontal: 10,
    paddingVertical: 10,
  },
  row: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 9,
  },
  thumb: {
    width: 34,
    height: 34,
    borderRadius: 9,
    borderWidth: StyleSheet.hairlineWidth,
    alignItems: 'center',
    justifyContent: 'center',
  },
  thumbDot: {
    width: 10,
    height: 10,
    borderRadius: 3,
  },
  playBadge: {
    width: 22,
    height: 22,
    borderRadius: 11,
    alignItems: 'center',
    justifyContent: 'center',
  },
  meta: {
    flex: 1,
    gap: 3,
    minHeight: 34,
    justifyContent: 'center',
  },
  title: {
    fontSize: 12,
    letterSpacing: 0.1,
  },
  statusSlot: {
    minHeight: 14,
    justifyContent: 'center',
  },
  metaText: {
    fontSize: 10,
    letterSpacing: 0.15,
  },
  playingSlot: {
    ...StyleSheet.absoluteFill,
    justifyContent: 'center',
  },
});
