import { useCallback, useRef, useState } from 'react';
import { useFocusEffect } from 'expo-router';

import { clearVidoraXCache } from '../services/cache-cleanup.service';
import { readDeviceStorageSnapshot } from '../services/device-storage.service';
import { scanAppStorageAsync } from '../services/storage-scanner.service';
import { buildStorageLocations } from '../services/storage-locations.service';
import type { StorageManagerSnapshot } from '../types/storage.types';

type StorageManagerState = {
  snapshot: StorageManagerSnapshot | null;
  loading: boolean;
  refreshing: boolean;
  clearingCache: boolean;
  error: string | null;
};

const initialState: StorageManagerState = {
  snapshot: null,
  loading: true,
  refreshing: false,
  clearingCache: false,
  error: null,
};

export function useStorageManager() {
  const [state, setState] = useState<StorageManagerState>(initialState);
  const inFlight = useRef(false);
  const hasLoaded = useRef(false);

  const load = useCallback(async (mode: 'initial' | 'refresh' = 'initial') => {
    if (inFlight.current) {
      return;
    }
    inFlight.current = true;

    setState((current) => ({
      ...current,
      loading: mode === 'initial' && current.snapshot == null,
      refreshing: mode === 'refresh',
      error: null,
    }));

    try {
      const device = readDeviceStorageSnapshot();
      const app = await scanAppStorageAsync();
      const locations = buildStorageLocations(app);

      setState({
        snapshot: { device, app, locations },
        loading: false,
        refreshing: false,
        clearingCache: false,
        error: null,
      });
    } catch {
      setState((current) => ({
        ...current,
        loading: false,
        refreshing: false,
        error: 'load_failed',
      }));
    } finally {
      inFlight.current = false;
    }
  }, []);

  useFocusEffect(
    useCallback(() => {
      void load(hasLoaded.current ? 'refresh' : 'initial');
      hasLoaded.current = true;
    }, [load]),
  );

  const refresh = useCallback(() => {
    void load('refresh');
  }, [load]);

  const clearCache = useCallback(async () => {
    setState((current) => ({ ...current, clearingCache: true }));
    try {
      await clearVidoraXCache();
      await load('refresh');
    } catch {
      setState((current) => ({
        ...current,
        clearingCache: false,
        error: 'cache_clear_failed',
      }));
    }
  }, [load]);

  return {
    ...state,
    refresh,
    clearCache,
  };
}
