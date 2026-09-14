import { memo, useMemo, type ReactNode } from 'react';
import { StatusBar, View } from 'react-native';
import Animated, { useAnimatedStyle } from 'react-native-reanimated';
import { useSafeAreaInsets } from 'react-native-safe-area-context';

import { useTheme } from '@/hooks/use-theme';
import { useTranslation } from '@/localization';
import { useReducedMotionPreference } from '@/screens/splash/hooks';
import { resolveIntroColors } from '@/theme';

import { useTrustSequence } from './animations';
import {
  DownloadWorkflow,
  TrustBackground,
  TrustCopy,
} from './components';
import { trustStyles } from './styles';

type TrustScreenProps = {
  footer?: ReactNode;
  enabled?: boolean;
};

/**
 * Onboarding Screen 2 — Trust / Control
 * Living download workflow that answers: "Why trust VidoraX with my downloads?"
 */
export const TrustScreen = memo(function TrustScreen({
  footer,
  enabled = true,
}: TrustScreenProps) {
  const { t } = useTranslation();
  const theme = useTheme();
  const intro = useMemo(() => resolveIntroColors(theme.mode), [theme.mode]);
  const insets = useSafeAreaInsets();
  const reducedMotion = useReducedMotionPreference();
  const sequence = useTrustSequence({ enabled, reducedMotion });

  const footerFade = useAnimatedStyle(() => ({
    opacity: sequence.footerOpacity.value,
  }));

  return (
    <View
      style={[trustStyles.root, { backgroundColor: intro.background }]}
      testID="onboarding-trust"
      accessibilityLabel={t('onboarding.trustA11y')}>
      <StatusBar barStyle={intro.statusBarStyle} backgroundColor={intro.background} />

      <TrustBackground
        opacity={sequence.backgroundOpacity}
        ambientGlow={sequence.ambientGlow}
      />

      <View style={[trustStyles.safe, { paddingBottom: Math.max(insets.bottom, 12) }]}>
        <View style={trustStyles.body}>
          <View style={trustStyles.hero}>
            <DownloadWorkflow sequence={sequence} />
          </View>

          <TrustCopy opacity={sequence.copyOpacity} translateY={sequence.copyTranslateY} />
        </View>

        {footer ? <Animated.View style={footerFade}>{footer}</Animated.View> : null}
      </View>
    </View>
  );
});
