import { memo } from 'react';

import { IconButton } from '@/components/buttons/IconButton';
import { useTranslation } from '@/localization';

import { useBrowserNavigation } from '@/browser/hooks';
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
      color="headerIcon"
      accessibilityLabel={isLoading ? t('browserAddress.stopLoading') : t('browserAddress.reloadPage')}
      accessibilityHint={isLoading ? t('browserAddress.stopHint') : t('browserAddress.reloadHint')}
      testID={testID}
    />
  );
});
