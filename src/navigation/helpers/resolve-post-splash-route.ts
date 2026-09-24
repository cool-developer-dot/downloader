import { routePaths, type RoutePath } from '../constants/route-paths';

/**
 * The in-app screens a link may open the app on: what the download notifications point at (`vidorax://downloads`
 * for a transfer, `vidorax://library` for a finished video). Anything else — including web links, which the browser
 * opens in a tab itself — starts on the Browser as usual.
 */
const LAUNCH_DESTINATIONS: Record<string, RoutePath> = {
  downloads: routePaths.downloads,
  library: routePaths.library,
};

/**
 * The screen a cold-start link asks for, or null. Accepts the app's own scheme and the router's path form
 * (`vidorax://library`, `/library`, `vidorax:///library/`); ignores queries and fragments.
 */
export function launchDestinationFromUrl(url: string | null | undefined): RoutePath | null {
  if (!url) {
    return null;
  }
  const trimmed = url.trim();
  let path: string;
  if (/^vidorax:/i.test(trimmed)) {
    path = trimmed.replace(/^vidorax:\/*/i, '');
  } else if (trimmed.startsWith('/')) {
    path = trimmed;
  } else {
    return null;
  }
  const key = path.split(/[?#]/)[0]?.replace(/^\/+|\/+$/g, '').toLowerCase() ?? '';
  return LAUNCH_DESTINATIONS[key] ?? null;
}

/**
 * Destination after Splash 1 (branded splash) finishes.
 *
 * First launch runs the cinematic pages (Gateway → Trust → Library) once:
 *
 *   Splash 1 → Splash 2–4 → Browser
 *
 * Afterwards the persisted `onboardingComplete` sends the user straight to Browser — the intro is an
 * introduction, not something to sit through on every cold start. When the app was started by a link to one of
 * its own screens (a download notification tapped while VidoraX was not running), that screen is where the user
 * lands: the splash must not swallow the destination they tapped.
 */
export function resolvePostSplashRoute(
  params?: { onboardingComplete?: boolean; launchUrl?: string | null },
): RoutePath {
  if (!params?.onboardingComplete) {
    return routePaths.onboarding;
  }
  return launchDestinationFromUrl(params.launchUrl) ?? routePaths.browser;
}
