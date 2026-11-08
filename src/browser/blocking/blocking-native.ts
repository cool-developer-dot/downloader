/**
 * B14 — what JS tells VidoraWeb about ad and tracker blocking, only on a change. With both switches off (the default)
 * no call is ever made (today's WebView). Pure apart from the driver, so it is tested under Node.
 */

export type BlockingNativeDriver = {
  setContentBlocking?(ads: boolean, trackers: boolean, allowedSites: string[]): void;
  setBlockingPage?(viewTag: number, url: string): Promise<boolean>;
  getBlockedCount?(viewTag: number): Promise<number>;
};

const MAX_TRACKED_VIEWS = 8;

export function createBlockingNative(driver: () => BlockingNativeDriver | null) {
  let sentRules: string | null = null;
  let enabled = false;
  const pages = new Map<number, string>();

  return {
    /** Sends the switches and the allowed sites when they differ from what was last sent. */
    setRules(ads: boolean, trackers: boolean, allowedSites: readonly string[]): boolean {
      const key = JSON.stringify([ads, trackers, [...allowedSites].sort()]);
      if (key === sentRules) return false;
      if (sentRules == null && !ads && !trackers) return false;
      const api = driver();
      if (!api?.setContentBlocking) return false;
      try {
        api.setContentBlocking(ads, trackers, [...allowedSites]);
      } catch {
        return false;
      }
      sentRules = key;
      enabled = ads || trackers;
      if (!enabled) pages.clear();
      return true;
    },
    /** The site a tab's page is on, while blocking is on and only when it changed for that view. */
    setPage(viewTag: number, host: string | null): boolean {
      if (!enabled || !host || pages.get(viewTag) === host) return false;
      const api = driver();
      const sent = api?.setBlockingPage?.(viewTag, `https://${host}/`);
      if (!sent) return false;
      pages.delete(viewTag);
      pages.set(viewTag, host);
      while (pages.size > MAX_TRACKED_VIEWS) pages.delete(pages.keys().next().value!);
      void sent.catch(() => {
        pages.delete(viewTag);
      });
      return true;
    },
    async blockedCount(viewTag: number | null): Promise<number> {
      if (viewTag == null) return 0;
      try {
        const count = await driver()?.getBlockedCount?.(viewTag);
        return typeof count === 'number' && Number.isFinite(count) && count > 0 ? Math.floor(count) : 0;
      } catch {
        return 0;
      }
    },
    forget(viewTag: number): void {
      pages.delete(viewTag);
    },
  };
}
