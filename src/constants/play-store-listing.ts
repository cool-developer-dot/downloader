/**
 * The VidoraX Google Play listing and how to open it. Pure (no React Native import) so the choice of URL is unit
 * tested; the Linking call lives in `src/utils/open-play-store-listing.ts`.
 *
 * The listing is opened in the Play Store app (`market://`) when one is installed, otherwise on the web.
 */

/** The Play application id — the listing every Rate / Check for Updates action points at. */
export const PLAY_STORE_PACKAGE_ID = 'com.vidorax.fast.videodownloader';

export type PlayStoreListingUrls = {
  /** Handled by the Play Store app. */
  app: string;
  /** Works in any browser, also when no Play Store app is installed. */
  web: string;
};

export function playStoreListingUrls(packageId: string = PLAY_STORE_PACKAGE_ID): PlayStoreListingUrls {
  const id = encodeURIComponent(packageId.trim());
  return {
    app: `market://details?id=${id}`,
    web: `https://play.google.com/store/apps/details?id=${id}`,
  };
}

export const PLAY_STORE_LISTING_URLS: PlayStoreListingUrls = playStoreListingUrls();

/** A Rate / update action is offered only for a real listing URL. */
export function isPlayStoreListingUrl(url: string | null | undefined): url is string {
  return typeof url === 'string' && url.trim().length > 0;
}

/** Opens a URL; rejects (throws) when no app on the device can handle it — `Linking.openURL` semantics. */
export type UrlOpener = (url: string) => Promise<unknown>;

export type PlayStoreOpenResult = 'play_store_app' | 'web' | 'failed';

/**
 * Tries the Play Store app first, then the web listing. `canOpenURL` is not used: `market:` would need its own
 * manifest query on Android 11+, and asking first adds nothing — opening fails cleanly when nothing handles it.
 */
export async function openPlayStoreListingWith(
  open: UrlOpener,
  urls: PlayStoreListingUrls = PLAY_STORE_LISTING_URLS,
): Promise<PlayStoreOpenResult> {
  try {
    await open(urls.app);
    return 'play_store_app';
  } catch {
    // No Play Store app (or it refused the link): fall back to the web listing.
  }
  try {
    await open(urls.web);
    return 'web';
  } catch {
    return 'failed';
  }
}
