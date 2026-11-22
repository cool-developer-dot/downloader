import { useCallback } from 'react';
import { ToastAndroid } from 'react-native';

import { useTranslation } from '@/localization';

/**
 * The design shows rows whose feature VidoraX does not have yet (mirror sources, floating widget, cloud sync…).
 * They stay on the screen exactly as drawn and say so when tapped.
 */
export function useNotAvailableYet(): () => void {
  const { t } = useTranslation();
  return useCallback(() => {
    ToastAndroid.show(t('common.notAvailableYet'), ToastAndroid.SHORT);
  }, [t]);
}
