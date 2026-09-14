import { memo } from 'react';

import { IconButton } from '@/components/buttons/IconButton';

import { useBrowserNavigation } from '@/browser/hooks';
import { selectIsHome, useBrowserStore } from '@/browser/stores';

export type ReloadStopButtonProps = {
  testID?: string;
};

export const ReloadStopButton = memo(function ReloadStopButton({
  testID = 'browser-reload-stop',
}: ReloadStopButtonProps) {
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
      color="headerIcon"
      accessibilityLabel={isLoading ? 'Stop loading' : 'Reload page'}
      accessibilityHint={
        isLoading ? 'Stops the current page from loading' : 'Reloads the current page'
      }
      testID={testID}
    />
  );
});
