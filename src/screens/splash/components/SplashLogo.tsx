import { Image } from 'expo-image';
import { memo } from 'react';
import { StyleSheet, View } from 'react-native';
import Animated, { type SharedValue, useAnimatedStyle } from 'react-native-reanimated';

import { SPLASH_LAYOUT, SPLASH_LOGO } from '../constants/splash.constants';
import { useTranslation } from '@/localization';

type SplashLogoProps = {
  opacity: SharedValue<number>;
  scale: SharedValue<number>;
};

/** Official VidoraX mark — centered hero, no containers or glow discs. */
export const SplashLogo = memo(function SplashLogo({ opacity, scale }: SplashLogoProps) {
  const { t } = useTranslation();
  const style = useAnimatedStyle(() => ({
    opacity: opacity.value,
    transform: [{ scale: scale.value }],
  }));

  return (
    <View style={styles.wrap}>
      <Animated.View style={style}>
        <Image
          source={SPLASH_LOGO}
          style={styles.logo}
          contentFit="contain"
          cachePolicy="memory-disk"
          recyclingKey="vidorax-cinematic-logo"
          accessibilityLabel={t('common.logoA11y')}
          accessible
        />
      </Animated.View>
    </View>
  );
});

const styles = StyleSheet.create({
  wrap: {
    width: SPLASH_LAYOUT.logoSize,
    height: SPLASH_LAYOUT.logoSize,
    alignItems: 'center',
    justifyContent: 'center',
  },
  logo: {
    width: SPLASH_LAYOUT.logoSize,
    height: SPLASH_LAYOUT.logoSize,
  },
});
