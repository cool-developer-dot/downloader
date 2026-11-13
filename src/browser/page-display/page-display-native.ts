/**
 * B16 — sends a tab's page layout and colour matrix to VidoraWeb, only when they change. A WebView that has never had
 * a non-default value gets no call at all, so with every setting at its default nothing differs from before B16.
 * Pure apart from the driver (tests stand in for the native module).
 */

export type PageLayoutValue = { textReflow: boolean; initialScale: number; darkening: boolean };

export type PageDisplayDriver = {
  setPageLayout?(viewTag: number, textAutosizing: boolean, initialScale: number, darkening: boolean): Promise<boolean>;
  setDisplayFilter?(viewTag: number, matrix: number[] | null): Promise<boolean>;
};

const MAX_TRACKED_VIEWS = 8;

function remember(map: Map<number, string>, tag: number, key: string): void {
  map.delete(tag);
  map.set(tag, key);
  while (map.size > MAX_TRACKED_VIEWS) map.delete(map.keys().next().value!);
}

export function createPageDisplayNative(driver: () => PageDisplayDriver | null) {
  const layouts = new Map<number, string>();
  const filters = new Map<number, string>();
  return {
    applyLayout(viewTag: number | null, layout: PageLayoutValue): boolean {
      if (viewTag == null) return false;
      const isDefault = !layout.textReflow && layout.initialScale === 0 && !layout.darkening;
      const key = `${layout.textReflow ? 1 : 0}|${layout.initialScale}|${layout.darkening ? 1 : 0}`;
      if (layouts.get(viewTag) === key || (!layouts.has(viewTag) && isDefault)) return false;
      const api = driver();
      if (!api?.setPageLayout) return false;
      remember(layouts, viewTag, key);
      void api.setPageLayout(viewTag, layout.textReflow, layout.initialScale, layout.darkening).catch(() => {
        layouts.delete(viewTag);
      });
      return true;
    },
    applyFilter(viewTag: number | null, matrix: number[] | null): boolean {
      if (viewTag == null) return false;
      const key = matrix ? matrix.join(',') : 'none';
      if (filters.get(viewTag) === key || (!filters.has(viewTag) && !matrix)) return false;
      const api = driver();
      if (!api?.setDisplayFilter) return false;
      remember(filters, viewTag, key);
      void api.setDisplayFilter(viewTag, matrix).catch(() => {
        filters.delete(viewTag);
      });
      return true;
    },
    /** A WebView that went away (its tag may be reused). */
    forget(viewTag: number): void {
      layouts.delete(viewTag);
      filters.delete(viewTag);
    },
  };
}
