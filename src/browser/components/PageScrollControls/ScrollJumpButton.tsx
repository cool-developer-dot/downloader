import { memo, useCallback, useSyncExternalStore } from 'react';
import Animated, { FadeIn, FadeOut } from 'react-native-reanimated';

import { Icon } from '@/components/base/Icon';
import { Pressable } from '@/components/base/Pressable';
import { pageActivity } from '@/browser/scroll/page-activity';
import { scrollActivePageToEdge } from '@/browser/scroll/page-scroll.service';
import { useTheme } from '@/hooks/use-theme';
import { useTranslation } from '@/localization';

/** B6 #46 / #47: the small ↑ / ↓ button after a fast scroll on a long page; a tap goes all the way, then it fades. */
export const ScrollJumpButton = memo(function ScrollJumpButton({
  visible,
  bottom,
}: {
  visible: boolean;
  bottom: number;
}) {
  const theme = useTheme();
  const { t, rtl } = useTranslation();
  const snapshot = useSyncExternalStore(pageActivity.subscribe, pageActivity.getSnapshot, pageActivity.getSnapshot);
  const target = snapshot.jumpTarget;

  const jump = useCallback(() => {
    if (!target) return;
    scrollActivePageToEdge(target);
    pageActivity.hideJump();
  }, [target]);

  if (!visible || !target) return null;

  const label = target === 'top' ? t('browserNav.scrollTop') : t('browserNav.scrollBottom');
  return (
    <Animated.View
      entering={FadeIn.duration(150)}
      exiting={FadeOut.duration(250)}
      style={{ position: 'absolute', bottom, ...(rtl.isRtl ? { left: 16 } : { right: 16 }), zIndex: 30 }}>
      <Pressable
        testID="browser-scroll-jump"
        accessibilityRole="button"
        accessibilityLabel={label}
        onPress={jump}
        style={{
          width: 48,
          height: 48,
          borderRadius: 24,
          alignItems: 'center',
          justifyContent: 'center',
          backgroundColor: theme.colors.card,
          borderWidth: 1,
          borderColor: theme.colors.border,
          ...theme.elevation.md,
        }}>
        <Icon name={target === 'top' ? 'arrow-collapse-up' : 'arrow-collapse-down'} size={24} color="primary" />
      </Pressable>
    </Animated.View>
  );
});
