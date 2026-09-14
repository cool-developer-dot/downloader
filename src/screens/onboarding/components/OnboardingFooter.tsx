import { memo } from 'react';
import { Pressable, StyleSheet, Text, View } from 'react-native';

import { useTranslation } from '@/localization';
import { fontFamilies } from '@/theme/typography';

import { useOnboardingSurfaces } from '../onboarding-surfaces-context';

import { OnboardingPagerDots } from './OnboardingPagerDots';

type OnboardingFooterProps = {
  pageIndex: number;
  onSkip: () => void;
  onContinue: () => void;
  continueLabel?: string;
};

export const OnboardingFooter = memo(function OnboardingFooter({
  pageIndex,
  onSkip,
  onContinue,
  continueLabel,
}: OnboardingFooterProps) {
  const { t, rtl } = useTranslation();
  const surfaces = useOnboardingSurfaces();
  const resolvedContinue = continueLabel ?? t('onboarding.continue');
  const forwardArrow = rtl.isRtl ? '←' : '→';
  return (
    <View style={[styles.footer, { flexDirection: rtl.rowDirection }]}>
      <Pressable
        onPress={onSkip}
        hitSlop={12}
        accessibilityRole="button"
        accessibilityLabel={t('onboarding.skipA11y')}
        style={styles.side}>
        <Text
          style={[
            styles.skip,
            { fontFamily: fontFamilies.body, color: surfaces.footerMuted },
          ]}>
          {t('onboarding.skip')}
        </Text>
      </Pressable>

      <OnboardingPagerDots activeIndex={pageIndex} />

      <Pressable
        onPress={onContinue}
        hitSlop={12}
        accessibilityRole="button"
        accessibilityLabel={resolvedContinue}
        style={styles.side}>
        <Text
          style={[
            styles.continue,
            {
              fontFamily: fontFamilies.bodySemiBold,
              textAlign: rtl.isRtl ? 'left' : 'right',
              color: surfaces.footerActive,
            },
          ]}>
          {rtl.isRtl ? `${forwardArrow}  ${resolvedContinue}` : `${resolvedContinue}  ${forwardArrow}`}
        </Text>
      </Pressable>
    </View>
  );
});

const styles = StyleSheet.create({
  footer: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    paddingHorizontal: 20,
    paddingTop: 16,
    paddingBottom: 8,
    minHeight: 56,
  },
  side: {
    minWidth: 88,
    minHeight: 44,
    justifyContent: 'center',
  },
  skip: {
    fontSize: 15,
    letterSpacing: 0.2,
  },
  continue: {
    fontSize: 15,
    letterSpacing: 0.2,
    textAlign: 'right',
  },
});
