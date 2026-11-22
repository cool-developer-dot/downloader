import { memo } from 'react';

import { Pressable } from '@/components/base/Pressable';
import { DsIcon, ds } from '@/design';
import { useTheme } from '@/hooks/use-theme';
import { useTranslation } from '@/localization';

import { BROWSER_TOUCH_TARGET } from '@/browser/constants';
import { useBrowserNavigation } from '@/browser/hooks';
import { hardReloadRequests } from '@/browser/services/hard-reload';
import { selectIsHome, useBrowserStore } from '@/browser/stores';

export type ReloadStopButtonProps = {
  testID?: string;
};

/** The design's bare 44 dp header control: a Lucide reload (↻) or stop (✕) stroke in the text colour. */
export const ReloadStopButton = memo(function ReloadStopButton({
  testID = 'browser-reload-stop',
}: ReloadStopButtonProps) {
  const theme = useTheme();
  const { t } = useTranslation();
  const { isLoading, handleReloadOrStop } = useBrowserNavigation();
  const isHome = useBrowserStore(selectIsHome);

  if (isHome) {
    return null;
  }

  // B6 #42: a long press on Reload reloads without the cache. Kept while loading (as a no-op): the button turns
  // into Stop as the reload starts, and without a long-press handler the release would count as a tap on Stop.
  const hardReload = () => {
    if (!isLoading) hardReloadRequests.request(useBrowserStore.getState().activeTabId);
  };

  return (
    <Pressable
      testID={testID}
      onPress={handleReloadOrStop}
      onLongPress={hardReload}
      delayLongPress={400}
      accessibilityRole="button"
      accessibilityLabel={isLoading ? t('browserAddress.stopLoading') : t('browserAddress.reloadPage')}
      accessibilityHint={isLoading ? t('browserAddress.stopHint') : t('browserAddress.reloadHint')}
      accessibilityActions={[{ name: 'longpress', label: t('browserNav.hardReload') }]}
      onAccessibilityAction={(event) => {
        if (event.nativeEvent.actionName === 'longpress') hardReload();
      }}
      hitSlop={4}
      style={({ pressed }) => ({
        width: BROWSER_TOUCH_TARGET,
        height: BROWSER_TOUCH_TARGET,
        borderRadius: ds.radius.iconButton,
        alignItems: 'center',
        justifyContent: 'center',
        backgroundColor: pressed ? theme.colors.surfacePressed : 'transparent',
      })}>
      <DsIcon name={isLoading ? 'x' : 'rotate-cw'} size={20} color="textPrimary" strokeWidth={ds.stroke.header} />
    </Pressable>
  );
});
