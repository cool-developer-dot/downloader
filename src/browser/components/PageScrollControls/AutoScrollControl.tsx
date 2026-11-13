import { memo, useEffect, useRef, useSyncExternalStore } from 'react';
import { AccessibilityInfo, View } from 'react-native';
import Animated, { FadeInDown, FadeOutDown } from 'react-native-reanimated';

import { Icon, type IconName } from '@/components/base/Icon';
import { Pressable } from '@/components/base/Pressable';
import { Text } from '@/components/base/Text';
import { AUTO_SCROLL_LEVELS } from '@/browser/scroll/auto-scroll';
import { pageActivity } from '@/browser/scroll/page-activity';
import { useTheme } from '@/hooks/use-theme';
import { useTranslation } from '@/localization';

function ControlButton({
  icon,
  label,
  onPress,
  disabled = false,
  testID,
}: {
  icon: IconName;
  label: string;
  onPress: () => void;
  disabled?: boolean;
  testID: string;
}) {
  return (
    <Pressable
      testID={testID}
      accessibilityRole="button"
      accessibilityLabel={label}
      accessibilityState={{ disabled }}
      disabled={disabled}
      onPress={onPress}
      style={{ width: 48, height: 48, alignItems: 'center', justifyContent: 'center' }}>
      <Icon name={icon} size={24} color={disabled ? 'disabled' : 'default'} />
    </Pressable>
  );
}

/** B6 #54: the floating Auto scroll control — pause / resume, slower, faster, stop — while it is on. */
export const AutoScrollControl = memo(function AutoScrollControl({
  visible,
  bottom,
}: {
  visible: boolean;
  bottom: number;
}) {
  const theme = useTheme();
  const { t, rtl } = useTranslation();
  const { autoScroll } = useSyncExternalStore(pageActivity.subscribe, pageActivity.getSnapshot, pageActivity.getSnapshot);
  const previous = useRef(autoScroll.status);

  useEffect(() => {
    const before = previous.current;
    previous.current = autoScroll.status;
    if (before === autoScroll.status) return;
    const message =
      autoScroll.status === 'running'
        ? t('browserNav.autoScrollStarted')
        : autoScroll.status === 'paused'
          ? t('browserNav.autoScrollPaused')
          : t('browserNav.autoScrollEnded');
    AccessibilityInfo.announceForAccessibility(message);
  }, [autoScroll.status, t]);

  if (!visible || autoScroll.status === 'off') return null;

  const running = autoScroll.status === 'running';
  const top = AUTO_SCROLL_LEVELS.length - 1;
  return (
    <Animated.View
      entering={FadeInDown.duration(160)}
      exiting={FadeOutDown.duration(160)}
      pointerEvents="box-none"
      style={{ position: 'absolute', bottom, left: 0, right: 0, alignItems: 'center', zIndex: 35 }}>
      <View
        testID="browser-auto-scroll"
        accessibilityRole="toolbar"
        accessibilityLabel={t('browserNav.autoScroll')}
        style={{
          flexDirection: rtl.rowDirection,
          alignItems: 'center',
          paddingHorizontal: 6,
          borderRadius: theme.radius.full,
          backgroundColor: theme.colors.card,
          borderWidth: 1,
          borderColor: theme.colors.border,
          ...theme.elevation.md,
        }}>
        <ControlButton
          testID="browser-auto-scroll-toggle"
          icon={running ? 'pause' : 'play'}
          label={running ? t('browserNav.autoScrollPause') : t('browserNav.autoScrollResume')}
          onPress={() => pageActivity.autoScroll({ type: 'toggle' })}
        />
        <ControlButton
          testID="browser-auto-scroll-slower"
          icon="minus"
          label={t('browserNav.autoScrollSlower')}
          disabled={autoScroll.level <= 0}
          onPress={() => pageActivity.autoScroll({ type: 'slower' })}
        />
        <Text
          variant="label"
          accessibilityLabel={t('browserNav.autoScrollSpeed', { level: autoScroll.level + 1, count: top + 1 })}
          style={{ minWidth: 28, textAlign: 'center' }}>
          {`${autoScroll.level + 1}`}
        </Text>
        <ControlButton
          testID="browser-auto-scroll-faster"
          icon="plus"
          label={t('browserNav.autoScrollFaster')}
          disabled={autoScroll.level >= top}
          onPress={() => pageActivity.autoScroll({ type: 'faster' })}
        />
        <ControlButton
          testID="browser-auto-scroll-stop"
          icon="close"
          label={t('browserNav.autoScrollStop')}
          onPress={() => pageActivity.autoScroll({ type: 'stop' })}
        />
      </View>
    </Animated.View>
  );
});
