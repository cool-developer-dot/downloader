import { memo, useCallback } from 'react';

import { IconButton } from '@/components/buttons/IconButton';
import { useTranslation } from '@/localization';
import { navigation, routePaths } from '@/navigation';

/** Downloads header → "Add several links" (Batch Add, #292). */
export const BatchAddHeaderButton = memo(function BatchAddHeaderButton() {
  const { t } = useTranslation();
  const open = useCallback(() => navigation.push(routePaths.batchAdd), []);
  return (
    <IconButton
      icon="playlist-plus"
      accessibilityLabel={t('linkIntake.batchTitle')}
      accessibilityHint={t('linkIntake.batchRowHint')}
      onPress={open}
      variant="ghost"
      color="headerIcon"
      testID="downloads-batch-add-button"
    />
  );
});
