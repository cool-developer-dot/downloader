/**
 * B18 — sends a tab's pictures-off and software-layer state to VidoraWeb, only on a change. A WebView that never had
 * a non-default value gets no call (pictures on, default layer — today's). Pure apart from the driver.
 */

export type SaverNativeDriver = {
  setBlockNetworkImage?(viewTag: number, block: boolean): Promise<boolean>;
  setSoftwareLayer?(viewTag: number, software: boolean): Promise<boolean>;
};

const MAX_TRACKED_VIEWS = 8;

function sticky(send: (api: SaverNativeDriver, tag: number, on: boolean) => Promise<boolean> | undefined) {
  const applied = new Map<number, boolean>();
  return {
    apply(driver: SaverNativeDriver | null, viewTag: number, on: boolean): boolean {
      if (applied.get(viewTag) === on || (!applied.has(viewTag) && !on)) return false;
      if (!driver) return false;
      const sent = send(driver, viewTag, on);
      if (!sent) return false;
      applied.delete(viewTag);
      applied.set(viewTag, on);
      while (applied.size > MAX_TRACKED_VIEWS) applied.delete(applied.keys().next().value!);
      void sent.catch(() => {
        applied.delete(viewTag);
      });
      return true;
    },
    forget(viewTag: number): void {
      applied.delete(viewTag);
    },
  };
}

export function createSaverNative(driver: () => SaverNativeDriver | null) {
  const images = sticky((api, tag, on) => api.setBlockNetworkImage?.(tag, on));
  const software = sticky((api, tag, on) => api.setSoftwareLayer?.(tag, on));
  return {
    applyImages(viewTag: number, off: boolean): boolean {
      return images.apply(driver(), viewTag, off);
    },
    applySoftware(viewTag: number, on: boolean): boolean {
      return software.apply(driver(), viewTag, on);
    },
    forget(viewTag: number): void {
      images.forget(viewTag);
      software.forget(viewTag);
    },
  };
}
