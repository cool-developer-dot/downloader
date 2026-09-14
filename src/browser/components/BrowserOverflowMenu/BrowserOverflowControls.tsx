import { memo, useCallback, useEffect, useRef, useState } from 'react';
import { View } from 'react-native';

import { Box } from '@/components/base/Box';
import { Icon } from '@/components/base/Icon';
import { Pressable } from '@/components/base/Pressable';
import { useTheme } from '@/hooks/use-theme';
import { useTranslation } from '@/localization';
import { BROWSER_TOUCH_TARGET } from '@/browser/constants';
import { primaryAlphas } from '@/theme';

import { useBrowserMenuActions } from './browser-menu-actions';
import { BrowserOverflowMenu } from './BrowserOverflowMenu';
import type { BrowserMenuFeedback, BrowserOverflowAnchor } from './types';

export type BrowserOverflowControlsProps = {
  testID?: string;
};

/**
 * Top-right browser overflow trigger + anchored Sage/Olive menu.
 */
export const BrowserOverflowControls = memo(function BrowserOverflowControls({
  testID = 'browser-overflow-controls',
}: BrowserOverflowControlsProps) {
  const theme = useTheme();
  const { t } = useTranslation();
  const primary = primaryAlphas(theme.colors.primary);
  const triggerRef = useRef<View>(null);
  const [visible, setVisible] = useState(false);
  const [anchor, setAnchor] = useState<BrowserOverflowAnchor | null>(null);
  const [feedback, setFeedback] = useState<BrowserMenuFeedback | null>(null);

  const closeMenu = useCallback(() => {
    setVisible(false);
  }, []);

  const openMenu = useCallback(() => {
    triggerRef.current?.measureInWindow((x, y, width, height) => {
      setAnchor({ x, y, width, height });
      setVisible(true);
    });
  }, []);

  const handleFeedback = useCallback((next: BrowserMenuFeedback) => {
    setFeedback(next);
  }, []);

  const { items, handleItemPress, handleDesktopToggle } = useBrowserMenuActions({
    onClose: closeMenu,
    onFeedback: handleFeedback,
  });

  useEffect(() => {
    if (!feedback) {
      return;
    }

    const timer = setTimeout(() => setFeedback(null), 2400);
    return () => clearTimeout(timer);
  }, [feedback]);

  return (
    <>
      <View ref={triggerRef} collapsable={false}>
        <Pressable
          testID={`${testID}-trigger`}
          onPress={openMenu}
          accessibilityRole="button"
          accessibilityLabel={t('browser.openMenuA11y')}
          accessibilityState={{ expanded: visible }}
          hitSlop={4}
          style={({ pressed }) => ({
            minWidth: BROWSER_TOUCH_TARGET,
            minHeight: BROWSER_TOUCH_TARGET,
            alignItems: 'center',
            justifyContent: 'center',
            borderRadius: theme.radius.md,
            backgroundColor: pressed ? primary.pressed : 'transparent',
          })}>
          <Icon name="dots-vertical" size="md" color="primary" />
        </Pressable>
      </View>

      {feedback ? (
        <Box
          accessibilityLiveRegion="polite"
          accessibilityLabel={feedback.message}
          style={{
            position: 'absolute',
            width: 1,
            height: 1,
            opacity: 0,
          }}
        />
      ) : null}

      <BrowserOverflowMenu
        visible={visible}
        anchor={anchor}
        items={items}
        onClose={closeMenu}
        onItemPress={handleItemPress}
        onDesktopToggle={handleDesktopToggle}
        testID={`${testID}-menu`}
      />
    </>
  );
});
