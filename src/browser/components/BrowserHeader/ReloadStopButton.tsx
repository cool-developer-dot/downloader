import { memo } from 'react';

import { IconButton } from '@/components/buttons/IconButton';
import { useTranslation } from '@/localization';

import { useBrowserNavigation } from '@/browser/hooks';
import { hardReloadRequests } from '@/browser/services/hard-reload';
import { selectIsHome, useBrowserStore } from '@/browser/stores';

export type ReloadStopButtonProps = {
  testID?: string;
};

export const ReloadStopButton = memo(function ReloadStopButton({
  testID = 'browser-reload-stop',
}: ReloadStopButtonProps) {
  const { t } = useTranslation();
  const { isLoading, handleReloadOrStop } = useBrowserNavigation();
  const isHome = useBrowserStore(selectIsHome);

  if (isHome) {
    return null;
  }

  return (
    <IconButton
      icon={isLoading ? 'close' : 'refresh'}
      variant="ghost"
      size="medium"
      onPress={handleReloadOrStop}
      // B6 #42: a long press on Reload reloads without the cache. Kept while loading (as a no-op): the button turns
      // into Stop as the reload starts, and without a long-press handler the release would count as a tap on Stop.
      onLongPress={() => {
        if (!isLoading) hardReloadRequests.request(useBrowserStore.getState().activeTabId);
      }}
      longPressLabel={t('browserNav.hardReload')}
      color="headerIcon"
      accessibilityLabel={isLoading ? t('browserAddress.stopLoading') : t('browserAddress.reloadPage')}
      accessibilityHint={isLoading ? t('browserAddress.stopHint') : t('browserAddress.reloadHint')}
      testID={testID}
    />
  );
});
