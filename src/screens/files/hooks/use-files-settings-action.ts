import { useMemo } from 'react';

import type { DsHeaderAction } from '@/design';
import { useTranslation } from '@/localization';
import { navigation, routePaths } from '@/navigation';

/** Files F2: the ⚙ of every Files screen but the tab (as designs 45, 56, 58 and 59 draw it): File manager settings. */
export function useFilesSettingsAction(): DsHeaderAction {
  const { t } = useTranslation();
  return useMemo(
    () => ({
      icon: 'settings',
      accessibilityLabel: t('fileManager.settingsTitle'),
      onPress: () => navigation.push(routePaths.filesSettings),
      testID: 'files-open-settings',
    }),
    [t],
  );
}
