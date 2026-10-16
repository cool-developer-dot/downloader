import { memo, useCallback, useEffect, useMemo, useRef, useState } from 'react';
import {
  AccessibilityInfo,
  findNodeHandle,
  ScrollView,
  StyleSheet,
  useWindowDimensions,
  View,
  type Text as NativeText,
} from 'react-native';
import Animated, {
  FadeIn,
  useAnimatedProps,
  useSharedValue,
  withTiming,
} from 'react-native-reanimated';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import Svg, { Path, Rect as SvgRect } from 'react-native-svg';

import { Box } from '@/components/base/Box';
import { Icon } from '@/components/base/Icon';
import { Text } from '@/components/base/Text';
import { Button } from '@/components/buttons/Button';
import { TextButton } from '@/components/buttons/TextButton';
import { BROWSER_TOUCH_TARGET } from '@/browser/constants';
import { useTheme } from '@/hooks/use-theme';
import { useTranslation, type TranslationKey } from '@/localization';
import { useReducedMotionPreference } from '@/screens/splash/hooks/useReducedMotionPreference';
import { SUPPORT_EMAIL_ADDRESS } from '@/support/support-email';
import { withAlpha } from '@/theme/colors';

import {
  isUsableRect,
  placeCard,
  spotlightPath,
  spotlightRect,
  videoBarRect,
  type Rect,
} from './tour-layout';
import { TOUR_STEP_COUNT, type TourStepId } from './tour-policy';
import { measureTourTarget, type TourTargetId } from './tour-targets';

const AnimatedPath = Animated.createAnimatedComponent(Path);
const AnimatedRect = Animated.createAnimatedComponent(SvgRect);

const SPOTLIGHT_RADIUS = 14;
const MOVE_MS = 260;

const STEP_TARGETS: Record<TourStepId, TourTargetId> = {
  addressBar: 'addressBar',
  startPage: 'startPage',
  videoAvailable: 'pageArea',
  downloadsTab: 'downloadsTab',
  playerTab: 'playerTab',
  settingsTab: 'settingsTab',
};

const STEP_TEXT: Record<TourStepId, { title: TranslationKey; body: TranslationKey }> = {
  addressBar: { title: 'tour.addressBarTitle', body: 'tour.addressBarBody' },
  startPage: { title: 'tour.startPageTitle', body: 'tour.startPageBody' },
  videoAvailable: { title: 'tour.videoAvailableTitle', body: 'tour.videoAvailableBody' },
  downloadsTab: { title: 'tour.downloadsTitle', body: 'tour.downloadsBody' },
  playerTab: { title: 'tour.playerTitle', body: 'tour.playerBody' },
  settingsTab: { title: 'tour.settingsTitle', body: 'tour.settingsBody' },
};

/** Where the step points: the real element, or for "Video available" the bar's real position above the toolbar. */
async function measureStep(step: TourStepId): Promise<Rect | null> {
  const rect = await measureTourTarget(STEP_TARGETS[step]);
  if (!rect) {
    return null;
  }
  return step === 'videoAvailable' ? videoBarRect(rect, BROWSER_TOUCH_TARGET) : rect;
}

export type TourOverlayProps = {
  step: TourStepId;
  stepIndex: number;
  onNext: () => void;
  onBack: () => void;
  onSkip: () => void;
  onTargetMissing: () => void;
};

/**
 * The coach mark: the whole window dimmed except the real element of the current step, and a card that explains it.
 * Drawn in the app's own window over everything (tabs included), so targets measured with `measureInWindow` line up
 * exactly. Taps outside the card do nothing — the tour moves only by Next / Back / Skip and the Back key.
 */
export const TourOverlay = memo(function TourOverlay({
  step,
  stepIndex,
  onNext,
  onBack,
  onSkip,
  onTargetMissing,
}: TourOverlayProps) {
  const theme = useTheme();
  const { t, rtl } = useTranslation();
  const windowSize = useWindowDimensions();
  const safeInsets = useSafeAreaInsets();
  const reducedMotion = useReducedMotionPreference();
  const [target, setTarget] = useState<{ step: TourStepId; rect: Rect } | null>(null);
  const titleRef = useRef<NativeText>(null);

  // The overlay's own place in the window: targets are measured in window coordinates and drawn relative to it, so
  // the spotlight lines up whether or not the app draws behind the system bars.
  const frameRef = useRef<View>(null);
  const [frame, setFrame] = useState<Rect | null>(null);
  const measureFrame = useCallback(() => {
    frameRef.current?.measureInWindow((x, y, width, height) => {
      setFrame((prev) =>
        prev && prev.x === x && prev.y === y && prev.width === width && prev.height === height
          ? prev
          : { x, y, width, height },
      );
    });
  }, []);
  const screenWidth = frame?.width ?? windowSize.width;
  const screenHeight = frame?.height ?? windowSize.height;
  const insets = useMemo(
    () => ({ top: Math.max(0, safeInsets.top - (frame?.y ?? 0)), bottom: safeInsets.bottom }),
    [frame?.y, safeInsets.bottom, safeInsets.top],
  );

  // Measure the step's element once the overlay knows its frame (again if the frame changes); a missing one skips
  // the step.
  useEffect(() => {
    if (!frame) {
      return undefined;
    }
    let cancelled = false;
    void measureStep(step).then((measured) => {
      if (cancelled) {
        return;
      }
      const rect = measured
        ? { x: measured.x - frame.x, y: measured.y - frame.y, width: measured.width, height: measured.height }
        : null;
      if (!isUsableRect(rect, frame)) {
        onTargetMissing();
        return;
      }
      setTarget({ step, rect });
    });
    return () => {
      cancelled = true;
    };
  }, [frame, onTargetMissing, step]);

  const ready = target?.step === step;
  const spot = useMemo(
    () => (target ? spotlightRect(target.rect, { width: screenWidth, height: screenHeight }) : null),
    [screenHeight, screenWidth, target],
  );

  // The spotlight glides from one element to the next (jumps when the user reduces motion).
  const sx = useSharedValue(0);
  const sy = useSharedValue(0);
  const sw = useSharedValue(0);
  const sh = useSharedValue(0);
  const placedRef = useRef(false);
  useEffect(() => {
    if (!spot) {
      return;
    }
    const animate = placedRef.current && !reducedMotion;
    const to = (value: number) => (animate ? withTiming(value, { duration: MOVE_MS }) : value);
    sx.value = to(spot.x);
    sy.value = to(spot.y);
    sw.value = to(spot.width);
    sh.value = to(spot.height);
    placedRef.current = true;
  }, [reducedMotion, sh, spot, sw, sx, sy]);

  const dimProps = useAnimatedProps(() => ({
    d: spotlightPath(
      { width: screenWidth, height: screenHeight },
      { x: sx.value, y: sy.value, width: sw.value, height: sh.value },
      SPOTLIGHT_RADIUS,
    ),
  }));
  const ringProps = useAnimatedProps(() => ({
    x: sx.value,
    y: sy.value,
    width: sw.value,
    height: sh.value,
  }));

  // TalkBack: read the step, then put focus on its title — once per step. The text is read through a ref: a new
  // translation function or re-render must never pull focus back to the title while the user moves through the card.
  const text = STEP_TEXT[step];
  const title = t(text.title);
  const body = t(text.body, { email: SUPPORT_EMAIL_ADDRESS });
  const announcement = t('tour.a11yStep', { current: stepIndex + 1, total: TOUR_STEP_COUNT, title, body });
  const announcementRef = useRef(announcement);
  useEffect(() => {
    announcementRef.current = announcement;
  }, [announcement]);
  useEffect(() => {
    if (!ready) {
      return undefined;
    }
    AccessibilityInfo.announceForAccessibility(announcementRef.current);
    const timer = setTimeout(() => {
      const node = titleRef.current ? findNodeHandle(titleRef.current) : null;
      if (node) {
        AccessibilityInfo.setAccessibilityFocus(node);
      }
    }, 450);
    return () => clearTimeout(timer);
  }, [ready, stepIndex]);

  const swallow = useCallback(() => true, []);

  const dimColor = theme.mode === 'dark' ? 'rgba(0, 0, 0, 0.8)' : 'rgba(0, 0, 0, 0.68)';
  const placement =
    ready && spot ? placeCard(spot, { width: screenWidth, height: screenHeight }, insets) : null;
  const isFirst = stepIndex === 0;
  const isLast = stepIndex === TOUR_STEP_COUNT - 1;
  const cardEntering = reducedMotion ? undefined : FadeIn.duration(200);

  return (
    <Animated.View
      testID="tour-overlay"
      style={StyleSheet.absoluteFill}
      entering={reducedMotion ? undefined : FadeIn.duration(220)}
      onStartShouldSetResponder={swallow}
      onResponderTerminationRequest={() => false}>
      <View ref={frameRef} collapsable={false} onLayout={measureFrame} style={StyleSheet.absoluteFill} pointerEvents="none" />
      <Svg
        width={screenWidth}
        height={screenHeight}
        style={StyleSheet.absoluteFill}
        pointerEvents="none"
        accessibilityElementsHidden
        importantForAccessibility="no-hide-descendants">
        <AnimatedPath animatedProps={dimProps} fill={dimColor} fillRule="evenodd" />
        {ready && spot ? (
          <AnimatedRect
            animatedProps={ringProps}
            rx={SPOTLIGHT_RADIUS}
            ry={SPOTLIGHT_RADIUS}
            fill="none"
            stroke="#FFFFFF"
            strokeWidth={2}
          />
        ) : null}
      </Svg>

      {ready && step === 'videoAvailable' && target ? <ExampleVideoBar rect={target.rect} /> : null}

      {placement ? (
        <Animated.View
          key={step}
          entering={cardEntering}
          testID="tour-card"
          style={{
            position: 'absolute',
            left: placement.left,
            width: placement.width,
            top: placement.top ?? undefined,
            bottom: placement.bottom ?? undefined,
          }}>
          {placement.caretX !== null ? (
            <View
              pointerEvents="none"
              style={{
                position: 'absolute',
                left: placement.caretX - 8,
                width: 16,
                height: 16,
                transform: [{ rotate: '45deg' }],
                backgroundColor: theme.colors.dialogBackground,
                ...(placement.side === 'below' ? { top: -7 } : { bottom: -7 }),
              }}
            />
          ) : null}
          <View
            style={{
              maxHeight: placement.maxHeight,
              borderRadius: theme.radius.lg,
              backgroundColor: theme.colors.dialogBackground,
              borderWidth: theme.mode === 'dark' ? 1 : 0,
              borderColor: theme.colors.border,
              elevation: 12,
              overflow: 'hidden',
            }}>
            {/* Header and buttons stay put; only the text scrolls, so Next is never below the fold. */}
            <View style={{ paddingHorizontal: 18, paddingTop: 16, paddingBottom: 6 }}>
              <Box row rtlRow center style={{ justifyContent: 'space-between', gap: 8 }}>
                <View
                  style={{
                    paddingHorizontal: 10,
                    paddingVertical: 3,
                    borderRadius: theme.radius.full,
                    backgroundColor: withAlpha(
                      theme.mode === 'dark' ? '#FFFFFF' : theme.colors.primary,
                      theme.mode === 'dark' ? 0.12 : 0.1,
                    ),
                  }}>
                  <Text variant="label" style={{ color: theme.colors.textPrimary }}>
                    {t('tour.stepOf', { current: stepIndex + 1, total: TOUR_STEP_COUNT })}
                  </Text>
                </View>
                {!isLast ? (
                  <TextButton
                    title={t('tour.skip')}
                    size="small"
                    onPress={onSkip}
                    accessibilityHint={t('tour.skipA11y')}
                    testID="tour-skip"
                  />
                ) : null}
              </Box>
            </View>
            <ScrollView
              bounces={false}
              style={{ flexGrow: 0, flexShrink: 1 }}
              contentContainerStyle={{ paddingHorizontal: 18, paddingVertical: 4, gap: 10 }}
              persistentScrollbar>
              <Text ref={titleRef} variant="subtitle" accessibilityRole="header" testID="tour-title">
                {title}
              </Text>
              <Text variant="body" color="textSecondary" testID="tour-body">
                {body}
              </Text>

              {step === 'settingsTab' ? (
                <Box
                  row
                  rtlRow
                  gap={10}
                  testID="tour-permitted-use"
                  style={{
                    alignItems: 'flex-start',
                    padding: 12,
                    borderRadius: theme.radius.md,
                    backgroundColor: theme.colors.backgroundSecondary,
                  }}>
                  <View style={{ paddingTop: 2 }}>
                    <Icon name="shield-check-outline" size={18} color="secondary" />
                  </View>
                  <Text variant="bodySmall" color="textSecondary" style={{ flex: 1 }}>
                    {t('tour.permittedUse')}
                  </Text>
                </Box>
              ) : null}

              <Box
                row
                rtlRow
                center
                gap={6}
                accessibilityElementsHidden
                importantForAccessibility="no-hide-descendants"
                style={{ justifyContent: 'center', paddingVertical: 2 }}>
                {Array.from({ length: TOUR_STEP_COUNT }, (_, index) => (
                  <View
                    key={index}
                    style={{
                      width: index === stepIndex ? 18 : 6,
                      height: 6,
                      borderRadius: 3,
                      backgroundColor:
                        index === stepIndex ? theme.colors.primary : withAlpha(theme.mode === 'dark' ? '#FFFFFF' : '#000000', 0.18),
                    }}
                  />
                ))}
              </Box>
            </ScrollView>
            <View style={{ paddingHorizontal: 18, paddingTop: 10, paddingBottom: 16 }}>
              <View style={{ flexDirection: rtl.rowDirection, gap: 10 }}>
                {!isFirst ? (
                  <Button
                    title={t('tour.back')}
                    variant="secondary"
                    onPress={onBack}
                    style={{ flex: 1 }}
                    testID="tour-back"
                  />
                ) : null}
                <Button
                  title={isLast ? t('tour.done') : t('tour.next')}
                  onPress={onNext}
                  style={{ flex: 1 }}
                  testID="tour-next"
                />
              </View>
            </View>
          </View>
        </Animated.View>
      ) : null}
    </Animated.View>
  );
});

/** An illustration of the "Video available" bar, drawn where the real one appears and marked as an example. */
const ExampleVideoBar = memo(function ExampleVideoBar({ rect }: { rect: Rect }) {
  const theme = useTheme();
  const { t } = useTranslation();
  return (
    <View
      testID="tour-example-video-bar"
      accessible
      accessibilityLabel={t('tour.exampleA11y')}
      style={{
        position: 'absolute',
        left: rect.x,
        top: rect.y,
        width: rect.width,
        height: rect.height,
      }}>
      <View
        style={{
          flex: 1,
          paddingHorizontal: theme.spacing[16],
          backgroundColor: theme.colors.card,
          borderTopWidth: StyleSheet.hairlineWidth,
          borderTopColor: theme.colors.border,
          borderBottomWidth: 2,
          borderBottomColor: theme.colors.primary,
          alignItems: 'center',
          justifyContent: 'space-between',
          flexDirection: 'row',
        }}>
        <Text variant="button" color="textPrimary" numberOfLines={1}>
          {t('browser.media.videoAvailable')}
        </Text>
        <Icon name="download" size={20} color="primary" />
      </View>
      <View
        style={{
          // At the bar's start, clear of the card's pointer (which aims at the bar's centre).
          position: 'absolute',
          top: -11,
          left: theme.spacing[16],
          paddingHorizontal: 10,
          paddingVertical: 2,
          borderRadius: theme.radius.full,
          backgroundColor: theme.colors.primary,
        }}>
        <Text variant="label" style={{ color: theme.colors.textOnPrimary, fontSize: 12, lineHeight: 16 }}>
          {t('tour.example')}
        </Text>
      </View>
    </View>
  );
});
