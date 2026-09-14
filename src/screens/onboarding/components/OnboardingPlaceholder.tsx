import { memo } from 'react';
import { StyleSheet, Text, View } from 'react-native';

import { fontFamilies } from '@/theme/typography';

import { useOnboardingSurfaces } from '../onboarding-surfaces-context';

type OnboardingPlaceholderProps = {
  title: string;
  subtitle: string;
};

/**
 * Lightweight reserved pages for future onboarding steps (2–3).
 * Keeps the 3-dot pager honest without diluting Screen 1 quality.
 */
export const OnboardingPlaceholder = memo(function OnboardingPlaceholder({
  title,
  subtitle,
}: OnboardingPlaceholderProps) {
  const surfaces = useOnboardingSurfaces();

  return (
    <View
      style={[styles.root, { backgroundColor: surfaces.background }]}
      accessibilityLabel={title}>
      <Text
        style={[
          styles.title,
          { fontFamily: fontFamilies.heading, color: surfaces.active },
        ]}>
        {title}
      </Text>
      <Text
        style={[
          styles.subtitle,
          { fontFamily: fontFamilies.body, color: surfaces.muted },
        ]}>
        {subtitle}
      </Text>
    </View>
  );
});

const styles = StyleSheet.create({
  root: {
    flex: 1,
    alignItems: 'center',
    justifyContent: 'center',
    paddingHorizontal: 32,
  },
  title: {
    fontSize: 28,
    lineHeight: 36,
    textAlign: 'center',
    letterSpacing: 0.2,
  },
  subtitle: {
    marginTop: 12,
    fontSize: 14,
    lineHeight: 21,
    textAlign: 'center',
    maxWidth: 320,
  },
});
