import { useCallback } from 'react';
import { AccessibilityInfo, ToastAndroid } from 'react-native';

import { useTranslation } from '@/localization';
import { navigation, routePaths } from '@/navigation';

import { voiceSearchInBrowser } from './voice-search';

function say(message: string): void {
  ToastAndroid.show(message, ToastAndroid.SHORT);
  AccessibilityInfo.announceForAccessibility(message);
}

/** The mic button: listen, open the words in the tab in front, and show the Browser tab. */
export function useVoiceSearch(): () => void {
  const { t } = useTranslation();
  return useCallback(() => {
    void voiceSearchInBrowser().then((outcome) => {
      if (outcome === 'opened') navigation.navigate(routePaths.browser);
      else if (outcome === 'unavailable') say(t('voiceSearch.unavailable'));
      else if (outcome === 'invalid') say(t('browser.addressInvalid'));
    });
  }, [t]);
}
