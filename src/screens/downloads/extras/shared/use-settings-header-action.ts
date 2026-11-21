import { useMemo } from 'react';

import type { DsHeaderAction } from '@/design';
import { useTranslation } from '@/localization';
import { navigation, routePaths } from '@/navigation';

/** The ⚙ button every download extra screen draws at the top right: opens Download settings. */
export function useSettingsHeaderAction(): DsHeaderAction {
  const { t } = useTranslation();
  return useMemo(
    () => ({
      icon: 'settings',
      accessibilityLabel: t('lightLiveConvert.settingsA11y'),
      onPress: () => navigation.push(routePaths.downloadSettings),
    }),
    [t],
  );
}
