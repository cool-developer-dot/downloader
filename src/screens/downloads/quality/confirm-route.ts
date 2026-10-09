/**
 * Where a quality-sheet confirmation goes.
 *
 * A sheet opened for a verified browser offer only ever hands that offer to the v2 engine. A navigation in the page
 * (an SPA route change, a feed or player moving on to the next video) releases the selection lock while the sheet
 * is still open; the choice on screen then belongs to a page that is gone, so it is stale — it must never fall
 * through to the paste-link path, which would start the previous video through the v1 engine.
 */
export type QualityConfirmRoute = 'browser_offer' | 'stale' | 'paste_link';

export function qualityConfirmRoute(input: {
  /** The sheet was opened from the browser offer (its selection was locked when the sheet opened). */
  openedForBrowserOffer: boolean;
  /** The browser offer's selection is still locked now. */
  selectionLocked: boolean;
  /** The locked offer still belongs to the page and content on screen. */
  offerCurrent: boolean;
}): QualityConfirmRoute {
  if (input.selectionLocked) {
    return input.offerCurrent ? 'browser_offer' : 'stale';
  }
  return input.openedForBrowserOffer ? 'stale' : 'paste_link';
}
