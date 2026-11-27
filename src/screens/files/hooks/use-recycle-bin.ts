/**
 * Files F8: what is in the Recycle bin, and its settings — loaded on focus and again whenever F13 says the bin changed
 * (`onBinChanged`; no polling). Read only through the `trash-port` stand-in until F13 merges.
 */

import { useFocusEffect } from 'expo-router';
import { useCallback, useEffect, useRef, useState } from 'react';

import { getBinSettings, listBin, onBinChanged } from '@/files/ui/trash-port';

export type BinItem = Awaited<ReturnType<typeof listBin>>[number];
export type BinSettings = ReturnType<typeof getBinSettings>;

export function useRecycleBin(enabled = true) {
  const [items, setItems] = useState<BinItem[]>([]);
  const [settings, setSettings] = useState<BinSettings>(() => getBinSettings());
  const [status, setStatus] = useState<'loading' | 'ready' | 'error'>('loading');
  const tokenRef = useRef(0);
  const liveRef = useRef(true);

  const reload = useCallback(async () => {
    const token = ++tokenRef.current;
    try {
      const next = await listBin();
      if (liveRef.current && token === tokenRef.current) {
        setItems(next);
        setSettings(getBinSettings());
        setStatus('ready');
      }
    } catch {
      if (liveRef.current && token === tokenRef.current) setStatus('error');
    }
  }, []);

  useEffect(() => {
    liveRef.current = true;
    return () => {
      liveRef.current = false;
    };
  }, []);

  useFocusEffect(
    useCallback(() => {
      if (!enabled) return undefined;
      void reload();
      return onBinChanged(() => {
        void reload();
      });
    }, [enabled, reload]),
  );

  return { items, settings, status, reload };
}
