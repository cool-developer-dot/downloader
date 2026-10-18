import { memo, useCallback } from 'react';

import { Divider } from '@/components/common/Divider';
import { useTranslation } from '@/localization';
import { navigation } from '@/navigation';
import { SettingsRow } from '@/screens/settings/components/SettingsRow';

/** The route of the Download history & logs screen (`src/app/(app)/download-history.tsx`). */
export const DOWNLOAD_HISTORY_ROUTE = '/download-history';

/** Settings → Downloads → "Download history & logs" (not the browsing History). */
export const DownloadHistoryLinkRow = memo(function DownloadHistoryLinkRow({ testID }: { testID?: string }) {
  const { t } = useTranslation();
  const open = useCallback(() => navigation.push(DOWNLOAD_HISTORY_ROUTE), []);
  return (
    <>
      <Divider />
      <SettingsRow
        title={t('downloadHistory.title')}
        description={t('downloadHistory.linkHint')}
        icon="clipboard-text-clock-outline"
        onPress={open}
        showDivider={false}
        accessibilityHint={t('downloadHistory.linkHint')}
        testID={testID}
      />
    </>
  );
});
