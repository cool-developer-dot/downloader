import { memo } from 'react';
import { Text, View } from 'react-native';
import Animated, { type SharedValue, useAnimatedStyle } from 'react-native-reanimated';

import { useTranslation } from '@/localization';
import { fontFamilies } from '@/theme/typography';

import { useOnboardingSurfaces } from '../../onboarding-surfaces-context';
import { gatewayStyles } from '../styles/gateway.styles';

type GatewayCopyProps = {
  opacity: SharedValue<number>;
  translateY: SharedValue<number>;
};

export const GatewayCopy = memo(function GatewayCopy({ opacity, translateY }: GatewayCopyProps) {
  const { t } = useTranslation();
  const surfaces = useOnboardingSurfaces();
  const style = useAnimatedStyle(() => ({
    opacity: opacity.value,
    transform: [{ translateY: translateY.value }],
  }));

  return (
    <Animated.View style={[gatewayStyles.copy, style]}>
      <View
        style={gatewayStyles.titleRow}
        accessibilityRole="header"
        accessibilityLabel={`${t('onboarding.gatewayTitleLead')} ${t('onboarding.gatewayTitleAccent')}`}>
        <Text
          style={[
            gatewayStyles.title,
            { fontFamily: fontFamilies.heading, color: surfaces.title },
          ]}>
          {t('onboarding.gatewayTitleLead')}
        </Text>
        <Text
          style={[
            gatewayStyles.title,
            { fontFamily: fontFamilies.heading, color: surfaces.titleAccent },
          ]}>
          {t('onboarding.gatewayTitleAccent')}
        </Text>
      </View>

      <Text
        style={[
          gatewayStyles.subtitle,
          { fontFamily: fontFamilies.body, color: surfaces.subtitle },
        ]}>
        {t('onboarding.gatewaySubtitle')}
      </Text>
    </Animated.View>
  );
});
