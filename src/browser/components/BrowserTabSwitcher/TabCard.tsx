import { memo, useCallback, useMemo, useSyncExternalStore } from 'react';
import { View, type AccessibilityActionEvent } from 'react-native';
import { Image } from 'expo-image';

import { Box } from '@/components/base/Box';
import { Icon } from '@/components/base/Icon';
import { Pressable } from '@/components/base/Pressable';
import { Text } from '@/components/base/Text';
import { tabSnapshots } from '@/browser/tabs/tab-snapshots';
import type { BrowserTab } from '@/browser/tabs/types';
import { isBrowserHomeUrl } from '@/browser/utils';
import { useTheme } from '@/hooks/use-theme';
import { useTranslation } from '@/localization';

import { tabDisplaySite, tabDisplayTitle } from './tab-display';
import { TabSoundButton, useTabSound } from '@/browser/tab-sound/components/TabSoundButton';

export const TAB_CARD_HEIGHT = 76;
const THUMB_WIDTH = 52;
const THUMB_HEIGHT = 64;

export type TabCardProps = {
  tab: BrowserTab;
  active: boolean;
  /** 1-based place in the list, for "Moved to position …". */
  position: number;
  count: number;
  dragEnabled: boolean;
  canMoveUp: boolean;
  canMoveDown: boolean;
  onSelect: (tabId: string) => void;
  onClose: (tabId: string) => void;
  onOptions: (tabId: string) => void;
  onMoveBy: (tabId: string, delta: -1 | 1) => void;
  /**
   * Long-press opens the tab's options on the card itself. Only where no gesture wraps the card: B1's sortable list
   * lifts or opens options through its own gesture; B2's grouped list has none, so it sets this.
   */
  longPressOptions?: boolean;
};

/** The tab's latest preview (B1 #14), re-read whenever a new one is saved. */
export function useTabSnapshot(tabId: string) {
  const version = useSyncExternalStore(tabSnapshots.subscribe, tabSnapshots.getVersion, tabSnapshots.getVersion);
  // eslint-disable-next-line react-hooks/exhaustive-deps -- `version` marks a newer snapshot for this id
  return useMemo(() => tabSnapshots.get(tabId), [tabId, version]);
}

export const TabPreviewImage = memo(function TabPreviewImage({
  tab,
  width,
  height,
  rounded,
}: {
  tab: BrowserTab;
  width: number | `${number}%`;
  height: number;
  rounded: number;
}) {
  const theme = useTheme();
  const { t } = useTranslation();
  const snapshot = useTabSnapshot(tab.id);
  const home = isBrowserHomeUrl(tab.url);

  return (
    <View
      style={{
        width,
        height,
        borderRadius: rounded,
        overflow: 'hidden',
        backgroundColor: theme.colors.background,
        borderWidth: 1,
        borderColor: theme.colors.border,
        alignItems: 'center',
        justifyContent: 'center',
      }}
      accessible={false}
      importantForAccessibility="no-hide-descendants">
      {snapshot && !home ? (
        <Image
          source={{ uri: snapshot.uri, cacheKey: `${tab.id}-${snapshot.takenAt}` }}
          cachePolicy="memory"
          contentFit="cover"
          contentPosition="top"
          style={{ width: '100%', height: '100%' }}
          accessibilityLabel={t('browserTabs.previewA11y', { title: tabDisplayTitle(tab, t) })}
        />
      ) : (
        <Icon name={home ? 'home' : 'web'} size={22} color="secondary" />
      )}
    </View>
  );
});

export const TabCard = memo(function TabCard({
  tab,
  active,
  position,
  count,
  dragEnabled,
  canMoveUp,
  canMoveDown,
  onSelect,
  onClose,
  onOptions,
  onMoveBy,
  longPressOptions = false,
}: TabCardProps) {
  const theme = useTheme();
  const { t, rtl } = useTranslation();
  const title = tabDisplayTitle(tab, t);
  const site = tabDisplaySite(tab, t);
  // B3 #283: the speaker while the page plays sound (or while muted), also in the card's spoken label.
  const sound = useTabSound(tab.id);

  const actions = useMemo(() => {
    const list: { name: string; label: string }[] = [{ name: 'longpress', label: t('browserTabs.menuA11y') }];
    if (canMoveUp) list.push({ name: 'moveUp', label: t('browserTabs.moveUp') });
    if (canMoveDown) list.push({ name: 'moveDown', label: t('browserTabs.moveDown') });
    list.push({ name: 'close', label: t('browserTabs.closeTab') });
    return list;
  }, [canMoveDown, canMoveUp, t]);

  const handleAction = useCallback(
    (event: AccessibilityActionEvent) => {
      switch (event.nativeEvent.actionName) {
        case 'moveUp':
          onMoveBy(tab.id, -1);
          break;
        case 'moveDown':
          onMoveBy(tab.id, 1);
          break;
        case 'longpress':
          onOptions(tab.id);
          break;
        case 'close':
          onClose(tab.id);
          break;
        default:
          break;
      }
    },
    [onClose, onMoveBy, onOptions, tab.id],
  );

  const label = [
    title,
    site,
    tab.pinned ? t('browserTabs.pinned') : null,
    sound.muted ? t('browserTabSound.muted') : sound.playing ? t('browserTabSound.playing') : null,
    active ? t('browser.tabActiveA11y') : null,
    `${position}/${count}`,
  ]
    .filter(Boolean)
    .join('. ');

  return (
    <Box
      style={{
        height: TAB_CARD_HEIGHT,
        flexDirection: rtl.rowDirection,
        alignItems: 'center',
        borderRadius: theme.radius.lg,
        borderWidth: active ? 2 : 1,
        borderColor: active ? theme.colors.primary : theme.colors.border,
        backgroundColor: theme.colors.surface,
        overflow: 'hidden',
      }}>
      <Pressable
        testID={`browser-tab-card-${tab.id.slice(0, 8)}`}
        accessibilityRole="button"
        accessibilityState={{ selected: active }}
        accessibilityLabel={label}
        accessibilityHint={dragEnabled ? t('browserTabs.cardHint') : t('browserTabs.cardHintNoDrag')}
        accessibilityActions={actions}
        onAccessibilityAction={handleAction}
        onPress={() => onSelect(tab.id)}
        onLongPress={longPressOptions ? () => onOptions(tab.id) : undefined}
        delayLongPress={380}
        style={{
          flex: 1,
          height: '100%',
          flexDirection: rtl.rowDirection,
          alignItems: 'center',
          gap: 12,
          paddingHorizontal: 10,
        }}>
        <TabPreviewImage tab={tab} width={THUMB_WIDTH} height={THUMB_HEIGHT} rounded={10} />
        <Box flex={1} style={{ minWidth: 0 }}>
          <Text variant="body" numberOfLines={1}>
            {title}
          </Text>
          <Box style={{ flexDirection: rtl.rowDirection, alignItems: 'center', gap: 4 }}>
            {tab.pinned ? <Icon name="pin" size={14} color="primary" /> : null}
            <Text variant="caption" color="textSecondary" numberOfLines={1} style={{ flexShrink: 1 }}>
              {site}
            </Text>
          </Box>
        </Box>
      </Pressable>
      <TabSoundButton tabId={tab.id} title={title} />
      <Pressable
        testID={`browser-tab-close-${tab.id.slice(0, 8)}`}
        accessibilityRole="button"
        accessibilityLabel={t('browserTabs.closeTabA11y', { title })}
        onPress={() => onClose(tab.id)}
        style={{ width: 48, height: 48, alignItems: 'center', justifyContent: 'center', marginHorizontal: 4 }}>
        <Icon name="close" size={20} color="secondary" />
      </Pressable>
    </Box>
  );
});
