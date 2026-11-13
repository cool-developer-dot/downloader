import { memo, useCallback } from 'react';

import { Divider } from '@/components/common/Divider';
import { useTranslation } from '@/localization';
import { navigation } from '@/navigation';
import { SettingsRow } from '@/screens/settings/components/SettingsRow';

/** The route of the Data usage screen (`src/app/(app)/data-usage.tsx`). */
export const DATA_USAGE_ROUTE = '/data-usage';

/** Settings → Storage → "Data usage". */
export const DataUsageLinkRow = memo(function DataUsageLinkRow({ testID }: { testID?: string }) {
  const { t } = useTranslation();
  const open = useCallback(() => navigation.push(DATA_USAGE_ROUTE), []);
  return (
    <>
      <Divider />
      <SettingsRow
        title={t('dataUsage.title')}
        description={t('dataUsage.linkHint')}
        icon="chart-bar"
        onPress={open}
        showDivider={false}
        accessibilityHint={t('dataUsage.linkHint')}
        testID={testID}
      />
    </>
  );
});
