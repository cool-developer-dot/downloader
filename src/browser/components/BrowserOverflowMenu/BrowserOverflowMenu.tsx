import { memo, useMemo } from 'react';
import {
  Modal,
  Pressable as RNPressable,
  ScrollView,
  StyleSheet,
  useWindowDimensions,
  View,
} from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';

import { Divider } from '@/components/common/Divider';
import { useTheme } from '@/hooks/use-theme';
import { useTranslation } from '@/localization';
import { withAlpha } from '@/theme';

import { BrowserMenuItem } from './BrowserMenuItem';
import type { BrowserMenuItemModel, BrowserOverflowAnchor } from './types';

const MENU_WIDTH = 288;
const MENU_MAX_HEIGHT = 420;
const ANCHOR_GAP = 8;

export type BrowserOverflowMenuProps = {
  visible: boolean;
  anchor: BrowserOverflowAnchor | null;
  items: BrowserMenuItemModel[];
  onClose: () => void;
  onItemPress: (id: BrowserMenuItemModel['id']) => void;
  onDesktopToggle: (enabled: boolean) => void;
  testID?: string;
};

export const BrowserOverflowMenu = memo(function BrowserOverflowMenu({
  visible,
  anchor,
  items,
  onClose,
  onItemPress,
  onDesktopToggle,
  testID = 'browser-overflow-menu',
}: BrowserOverflowMenuProps) {
  const theme = useTheme();
  const insets = useSafeAreaInsets();
  const { width: windowWidth, height: windowHeight } = useWindowDimensions();
  const { t } = useTranslation();

  const menuPosition = useMemo(() => {
    const menuWidth = Math.min(MENU_WIDTH, Math.max(240, windowWidth - 24));
    if (!anchor) {
      return {
        top: insets.top + 56,
        right: 12,
        width: menuWidth,
        maxHeight: MENU_MAX_HEIGHT,
      };
    }

    const preferredTop = anchor.y + anchor.height + ANCHOR_GAP;
    const availableHeight = Math.max(
      160,
      windowHeight - insets.bottom - insets.top - 24,
    );
    const maxHeight = Math.min(MENU_MAX_HEIGHT, availableHeight);
    const maxTop = windowHeight - insets.bottom - Math.min(maxHeight, 200) - 12;
    const top = Math.min(Math.max(preferredTop, insets.top + 8), Math.max(insets.top + 8, maxTop));

    const right = Math.max(12, windowWidth - (anchor.x + anchor.width));
    // Keep menu fully on-screen for narrow/landscape widths.
    const maxRight = Math.max(12, windowWidth - menuWidth - 12);
    const clampedRight = Math.min(right, maxRight);

    return {
      top,
      right: clampedRight,
      width: menuWidth,
      maxHeight: Math.min(maxHeight, windowHeight - top - insets.bottom - 12),
    };
  }, [anchor, insets.bottom, insets.top, windowHeight, windowWidth]);

  const surfaceBorder = withAlpha(theme.colors.textPrimary, 0.08);

  // Unmount when dismissed — Android transparent Modal can intercept touches
  // after visible=false, leaving the Browser chrome unresponsive.
  if (!visible) {
    return null;
  }

  return (
    <Modal
      visible
      transparent
      animationType="fade"
      onRequestClose={onClose}
      statusBarTranslucent>
      <View style={styles.root} testID={testID ? `${testID}-root` : undefined}>
        <RNPressable
          accessibilityRole="button"
          accessibilityLabel={t('common.dismiss')}
          onPress={onClose}
          style={[
            styles.backdrop,
            { backgroundColor: withAlpha(theme.colors.black, theme.opacity.overlay) },
          ]}
        />

        <View
          testID={testID}
          accessibilityRole="menu"
          accessibilityLabel={t('browser.menu')}
          style={[
            styles.menu,
            theme.elevation.lg,
            {
              top: menuPosition.top,
              right: menuPosition.right,
              width: menuPosition.width,
              maxHeight: menuPosition.maxHeight,
              backgroundColor: theme.colors.card,
              borderColor: surfaceBorder,
              borderRadius: theme.radius.lg,
            },
          ]}>
          <ScrollView
            bounces={false}
            showsVerticalScrollIndicator={false}
            keyboardShouldPersistTaps="handled">
            {items.map((item, index) => (
              <View key={item.id}>
                {item.showDividerBefore && index > 0 ? (
                  <Divider style={{ marginVertical: 4, marginHorizontal: 12 }} />
                ) : null}
                <BrowserMenuItem
                  item={item}
                  onPress={onItemPress}
                  onToggle={(id, enabled) => {
                    if (id === 'desktop_site') {
                      onDesktopToggle(enabled);
                    }
                  }}
                  testID={`${testID}-item-${item.id}`}
                />
              </View>
            ))}
          </ScrollView>
        </View>
      </View>
    </Modal>
  );
});

const styles = StyleSheet.create({
  root: {
    flex: 1,
  },
  backdrop: {
    ...StyleSheet.absoluteFill,
  },
  menu: {
    position: 'absolute',
    borderWidth: StyleSheet.hairlineWidth,
    overflow: 'hidden',
    paddingVertical: 6,
  },
});
