import { memo } from 'react';
import { View } from 'react-native';
import Animated, { type SharedValue, useAnimatedStyle } from 'react-native-reanimated';

import { useTranslation } from '@/localization';
import { fontFamilies } from '@/theme/typography';

import { SPLASH_BRAND_LETTERS } from '../constants/splash.constants';
import { splashStyles } from '../styles/splash.styles';

type SplashBrandProps = {
  letterOpacities: SharedValue<number>[];
  letterTranslateYs: SharedValue<number>[];
  brandTextColor?: string;
};

type BrandLetterProps = {
  letter: string;
  opacity: SharedValue<number>;
  translateY: SharedValue<number>;
  brandTextColor?: string;
};

const BrandLetter = memo(function BrandLetter({
  letter,
  opacity,
  translateY,
  brandTextColor,
}: BrandLetterProps) {
  const style = useAnimatedStyle(() => ({
    opacity: opacity.value,
    transform: [{ translateY: translateY.value }],
  }));

  return (
    <Animated.Text
      maxFontSizeMultiplier={1.35}
      style={[
        splashStyles.brandLetter,
        brandTextColor ? { color: brandTextColor } : null,
        { fontFamily: fontFamilies.heading, opacity: 0 },
        style,
      ]}>
      {letter}
    </Animated.Text>
  );
});

/** Sequential brand reveal — V → Vi → … → VidoraX */
export const SplashBrand = memo(function SplashBrand({
  letterOpacities,
  letterTranslateYs,
  brandTextColor,
}: SplashBrandProps) {
  const { t } = useTranslation();
  return (
    <View
      style={splashStyles.brandRow}
      accessibilityRole="header"
      accessibilityLabel={t('splash.brandName')}>
      {SPLASH_BRAND_LETTERS.map((letter, index) => (
        <BrandLetter
          key={`${letter}-${index}`}
          letter={letter}
          opacity={letterOpacities[index]}
          translateY={letterTranslateYs[index]}
          brandTextColor={brandTextColor}
        />
      ))}
    </View>
  );
});
