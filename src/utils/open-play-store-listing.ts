import { Linking } from 'react-native';

import { openPlayStoreListingWith, type PlayStoreOpenResult } from '@/constants/play-store-listing';

/** Opens the VidoraX Play listing: the Play Store app when installed, else the web page. Never throws. */
export function openPlayStoreListing(): Promise<PlayStoreOpenResult> {
  return openPlayStoreListingWith((url) => Linking.openURL(url));
}
