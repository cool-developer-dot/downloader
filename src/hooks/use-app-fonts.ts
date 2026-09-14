import { useFonts } from 'expo-font';
import { Platform } from 'react-native';

import { appFontAssets } from '@/theme/typography';

export function useAppFonts() {
  const [loaded, error] = useFonts(
    Platform.OS === 'web' ? {} : appFontAssets,
  );

  return {
    loaded: Platform.OS === 'web' ? true : loaded,
    error,
  };
}
