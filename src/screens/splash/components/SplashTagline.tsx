import { memo } from 'react';
import { View } from 'react-native';
import Animated, { type SharedValue, useAnimatedStyle } from 'react-native-reanimated';

import { useTranslation } from '@/localization';
import { fontFamilies } from '@/theme/typography';
import { splashStyles } from '../styles/splash.styles';

type SplashTaglineProps = {
  wordOpacities: SharedValue<number>[];
  wordTranslateYs: SharedValue<number>[];
  wordScales: SharedValue<number>[];
  taglineTextColor?: string;
  taglineDotColor?: string;
};

type TaglineWordProps = {
  word: string;
  opacity: SharedValue<number>;
  translateY: SharedValue<number>;
  scale: SharedValue<number>;
  showDotBefore: boolean;
  taglineTextColor?: string;
  taglineDotColor?: string;
};

const TaglineWord = memo(function TaglineWord({
  word,
  opacity,
  translateY,
  scale,
  showDotBefore,
  taglineTextColor,
  taglineDotColor,
}: TaglineWordProps) {
  const wordStyle = useAnimatedStyle(() => ({
    opacity: opacity.value,
    transform: [{ translateY: translateY.value }, { scale: scale.value }],
  }));

  const dotStyle = useAnimatedStyle(() => ({
    opacity: opacity.value * 0.7,
  }));

  return (
    <View style={splashStyles.taglineItem}>
      {showDotBefore ? (
        <Animated.View
          style={[
            splashStyles.taglineDot,
            taglineDotColor ? { backgroundColor: taglineDotColor } : null,
            dotStyle,
          ]}
        />
      ) : null}
      <Animated.Text
        maxFontSizeMultiplier={1.3}
        style={[
          splashStyles.taglineWord,
          taglineTextColor ? { color: taglineTextColor } : null,
          { fontFamily: fontFamilies.bodySemiBold, opacity: 0 },
          wordStyle,
        ]}>
        {word.toUpperCase()}
      </Animated.Text>
    </View>
  );
});

/**
 * Eye-catching triad: Fast · Reliable · Secure
 * Each word fades/rises/scales in with a soft stagger.
 */
export const SplashTagline = memo(function SplashTagline({
  wordOpacities,
  wordTranslateYs,
  wordScales,
  taglineTextColor,
  taglineDotColor,
}: SplashTaglineProps) {
  const { t } = useTranslation();
  const words = [
    t('splash.taglineFast'),
    t('splash.taglineReliable'),
    t('splash.taglineSecure'),
  ];
  return (
    <View
      style={splashStyles.taglineRow}
      accessibilityRole="text"
      accessibilityLabel={words.join(', ')}>
      {words.map((word, index) => (
        <TaglineWord
          key={word}
          word={word}
          opacity={wordOpacities[index]}
          translateY={wordTranslateYs[index]}
          scale={wordScales[index]}
          showDotBefore={index > 0}
          taglineTextColor={taglineTextColor}
          taglineDotColor={taglineDotColor}
        />
      ))}
    </View>
  );
});
