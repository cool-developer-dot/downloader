/** The route of the Save a site screen (`src/app/(app)/site-grabber.tsx`); `?url=` starts it on a page. */
export const SITE_GRABBER_ROUTE = '/site-grabber';

export function siteGrabberPath(url?: string | null): string {
  return url ? `${SITE_GRABBER_ROUTE}?url=${encodeURIComponent(url)}` : SITE_GRABBER_ROUTE;
}
