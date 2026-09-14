import {
  forwardRef,
  memo,
  useImperativeHandle,
  useMemo,
  type ReactNode,
} from 'react';
import { StatusBar, View } from 'react-native';
import Animated, { useAnimatedStyle } from 'react-native-reanimated';
import { useSafeAreaInsets } from 'react-native-safe-area-context';

import { useTheme } from '@/hooks/use-theme';
import { useTranslation } from '@/localization';
import { useReducedMotionPreference } from '@/screens/splash/hooks';
import { resolveIntroColors } from '@/theme';

import { useLibrarySequence } from './animations';
import {
  LibraryBackground,
  LibraryCopy,
  MediaLibraryHero,
} from './components';
import { libraryStyles } from './styles';

export type LibraryScreenHandle = {
  playExit: (onFinished: () => void) => void;
};

type LibraryScreenProps = {
  footer?: ReactNode;
  enabled?: boolean;
};

/**
 * Onboarding Screen 3 — Library / Hub
 * Animated media ecosystem answering: "What happens after downloads finish?"
 */
export const LibraryScreen = memo(
  forwardRef<LibraryScreenHandle, LibraryScreenProps>(function LibraryScreen(
    { footer, enabled = true },
    ref,
  ) {
    const { t } = useTranslation();
    const theme = useTheme();
    const intro = useMemo(() => resolveIntroColors(theme.mode), [theme.mode]);
    const insets = useSafeAreaInsets();
    const reducedMotion = useReducedMotionPreference();
    const sequence = useLibrarySequence({ enabled, reducedMotion });

    useImperativeHandle(
      ref,
      () => ({
        playExit: sequence.playExit,
      }),
      [sequence.playExit],
    );

    const footerFade = useAnimatedStyle(() => ({
      opacity: sequence.footerOpacity.value * sequence.exitOpacity.value,
    }));

    const contentExit = useAnimatedStyle(() => ({
      opacity: sequence.exitOpacity.value,
      transform: [
        { translateY: sequence.exitTranslateY.value },
        { scale: sequence.exitScale.value },
      ],
    }));

    return (
      <View
        style={[libraryStyles.root, { backgroundColor: intro.background }]}
        testID="onboarding-library"
        accessibilityLabel={t('onboarding.libraryA11y')}>
        <StatusBar barStyle={intro.statusBarStyle} backgroundColor={intro.background} />

        <LibraryBackground
          opacity={sequence.backgroundOpacity}
          ambientGlow={sequence.ambientGlow}
        />

        <View style={[libraryStyles.safe, { paddingBottom: Math.max(insets.bottom, 12) }]}>
          <Animated.View style={[libraryStyles.body, contentExit]}>
            <View style={libraryStyles.hero}>
              <MediaLibraryHero sequence={sequence} />
            </View>

            <LibraryCopy
              opacity={sequence.copyOpacity}
              translateY={sequence.copyTranslateY}
            />
          </Animated.View>

          {footer ? <Animated.View style={footerFade}>{footer}</Animated.View> : null}
        </View>
      </View>
    );
  }),
);
