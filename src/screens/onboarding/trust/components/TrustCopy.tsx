import { memo } from 'react';
import { Text } from 'react-native';
import Animated, { type SharedValue, useAnimatedStyle } from 'react-native-reanimated';

import { useTranslation } from '@/localization';
import { fontFamilies } from '@/theme/typography';

import { useOnboardingSurfaces } from '../../onboarding-surfaces-context';
import { TRUST_LAYOUT } from '../constants';
import { trustStyles } from '../styles';

type TrustCopyProps = {
  opacity: SharedValue<number>;
  translateY: SharedValue<number>;
};

export const TrustCopy = memo(function TrustCopy({ opacity, translateY }: TrustCopyProps) {
  const { t } = useTranslation();
  const surfaces = useOnboardingSurfaces();
  const style = useAnimatedStyle(() => ({
    opacity: opacity.value,
    transform: [{ translateY: translateY.value }],
  }));

  const a11yLabel = t('onboarding.trustA11y');

  return (
    <Animated.View style={[trustStyles.copy, style]}>
      <Text
        accessibilityRole="header"
        accessibilityLabel={a11yLabel}
        style={[
          trustStyles.title,
          { fontFamily: fontFamilies.heading, color: surfaces.title },
        ]}
        maxFontSizeMultiplier={TRUST_LAYOUT.maxFontMultiplier}>
        {t('onboarding.trustTitleLead')}{' '}
        <Text style={{ color: surfaces.titleAccent }}>{t('onboarding.trustTitleAccent')}</Text>
        {'\n'}
        {t('onboarding.trustTitleTrail')}
      </Text>

      <Text
        style={[
          trustStyles.subtitle,
          { fontFamily: fontFamilies.body, color: surfaces.subtitle },
        ]}
        maxFontSizeMultiplier={TRUST_LAYOUT.maxFontMultiplier}
        numberOfLines={2}>
        {t('onboarding.trustSubtitle')}
      </Text>
    </Animated.View>
  );
});
