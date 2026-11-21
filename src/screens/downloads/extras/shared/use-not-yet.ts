import { useCallback } from 'react';
import { ToastAndroid } from 'react-native';

import { useTranslation } from '@/localization';

/** The design's rows whose feature is not built yet: tapping says so (the kit rule) instead of doing nothing. */
export function useNotYet(): () => void {
  const { t } = useTranslation();
  return useCallback(() => {
    ToastAndroid.show(t('common.notAvailableYet'), ToastAndroid.SHORT);
  }, [t]);
}
