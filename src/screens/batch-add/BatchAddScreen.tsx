import { memo, useCallback } from 'react';

import { DsHeader, DsScreen } from '@/design';
import { useTranslation } from '@/localization';
import { navigation } from '@/navigation';

import { BatchAddBody } from './BatchAddBody';
import { useBatchAdd } from './useBatchAdd';

/**
 * Batch Add (#292): paste several links (or import a .txt file, #293); each one is checked and, if possible, added.
 * The same editor sits under the Batch chip of Add download (design 11); this route keeps the Link Grabber's and the
 * settings' entry points working.
 */
export const BatchAddScreen = memo(function BatchAddScreen() {
  const { t } = useTranslation();
  const batch = useBatchAdd();
  const goBack = useCallback(() => navigation.back(), []);

  return (
    <DsScreen testID="batch-add-screen">
      <DsHeader title={t('linkIntake.batchTitle')} subtitle={t('linkIntake.batchRowHint')} onBack={goBack} testID="batch-add-header" />
      <BatchAddBody batch={batch} />
    </DsScreen>
  );
});
