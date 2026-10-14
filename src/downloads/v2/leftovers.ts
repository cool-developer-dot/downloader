/**
 * Leftover download files (F15): files on the device that no download needs any more — work folders of finished,
 * cancelled or unknown downloads, and the temporary parts of v1 downloads that are no longer active. The engine finds
 * and deletes them; JavaScript tells it which v1 downloads are still active (their records live here).
 */

import { useCallback, useEffect, useRef, useState } from 'react';

import type { LeftoverFiles } from '@modules/vidorax-media/src/VidoraMedia.types';

import { useDownloadsStore } from '@/store/downloads';

import { getV2Engine } from './engine-port';
import { activeLegacyIds } from './leftovers-policy';

/** What the engine is told to keep, read at the moment of asking. */
function leftoverOptions(): { keepLegacyIds: string[] } {
  return { keepLegacyIds: activeLegacyIds(useDownloadsStore.getState().itemsById) };
}

export type LeftoverFilesState = {
  /** False on a build without the engine call: nothing is shown. */
  available: boolean;
  leftovers: LeftoverFiles | null;
  measuring: boolean;
  cleaning: boolean;
  /** Bytes the last clean-up freed (shown once, until the next measure). */
  freedBytes: number | null;
  failed: boolean;
  refresh: () => Promise<void>;
  clean: () => Promise<void>;
};

export function useLeftoverFiles(): LeftoverFilesState {
  const engine = getV2Engine();
  const available = typeof engine?.measureLeftoverFiles === 'function' && typeof engine?.cleanLeftoverFiles === 'function';
  const [leftovers, setLeftovers] = useState<LeftoverFiles | null>(null);
  const [measuring, setMeasuring] = useState(false);
  const [cleaning, setCleaning] = useState(false);
  const [freedBytes, setFreedBytes] = useState<number | null>(null);
  const [failed, setFailed] = useState(false);
  const mounted = useRef(true);

  useEffect(() => {
    mounted.current = true;
    return () => {
      mounted.current = false;
    };
  }, []);

  const refresh = useCallback(async () => {
    if (!available || !engine?.measureLeftoverFiles) {
      return;
    }
    setMeasuring(true);
    try {
      const next = await engine.measureLeftoverFiles(leftoverOptions());
      if (mounted.current) {
        setLeftovers(next);
        setFailed(false);
      }
    } catch {
      if (mounted.current) {
        setFailed(true);
      }
    } finally {
      if (mounted.current) {
        setMeasuring(false);
      }
    }
  }, [available, engine]);

  const clean = useCallback(async () => {
    if (!available || !engine?.cleanLeftoverFiles) {
      return;
    }
    setCleaning(true);
    try {
      const freed = await engine.cleanLeftoverFiles(leftoverOptions());
      if (!mounted.current) {
        return;
      }
      setFreedBytes(freed.bytes);
      setFailed(false);
      const rest = engine.measureLeftoverFiles ? await engine.measureLeftoverFiles(leftoverOptions()) : null;
      if (mounted.current) {
        setLeftovers(rest);
      }
    } catch {
      if (mounted.current) {
        setFailed(true);
      }
    } finally {
      if (mounted.current) {
        setCleaning(false);
      }
    }
  }, [available, engine]);

  // The first look when the screen opens; Storage's pull-to-refresh and a clean-up look again through `refresh`.
  useEffect(() => {
    if (!available || !engine?.measureLeftoverFiles) {
      return;
    }
    let cancelled = false;
    engine.measureLeftoverFiles(leftoverOptions()).then(
      (next) => {
        if (!cancelled) {
          setLeftovers(next);
        }
      },
      () => {
        if (!cancelled) {
          setFailed(true);
        }
      },
    );
    return () => {
      cancelled = true;
    };
  }, [available, engine]);

  return { available, leftovers, measuring, cleaning, freedBytes, failed, refresh, clean };
}
