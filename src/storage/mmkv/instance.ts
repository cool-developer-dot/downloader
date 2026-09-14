import { MMKV_INSTANCE_ID } from '@/storage/constants';
import { StorageError } from '@/storage/types';

/** Minimal MMKV surface used by this app — avoids importing the native module at eval time. */
export type MmkvInstance = {
  getString: (key: string) => string | undefined;
  getBoolean: (key: string) => boolean | undefined;
  getNumber: (key: string) => number | undefined;
  set: (key: string, value: boolean | string | number) => void;
  contains: (key: string) => boolean;
  remove: (key: string) => boolean;
  getAllKeys: () => string[];
  clearAll: () => void;
};

type CreateMMKV = (options?: { id?: string }) => MmkvInstance;

let mmkvInstance: MmkvInstance | null = null;
let mmkvUnavailableReason: string | null = null;
let createMMKVFn: CreateMMKV | null | undefined;

function isExpoGoRuntime(): boolean {
  try {
    // Lazy require so this module stays safe if Constants is unavailable.
    // eslint-disable-next-line @typescript-eslint/no-require-imports
    const Constants = require('expo-constants').default as {
      executionEnvironment?: string;
      appOwnership?: string | null;
    };
    const ExecutionEnvironment = require('expo-constants').ExecutionEnvironment as {
      StoreClient?: string;
    };

    return (
      Constants.executionEnvironment === ExecutionEnvironment.StoreClient ||
      Constants.appOwnership === 'expo'
    );
  } catch {
    return false;
  }
}

/**
 * Lazily load react-native-mmkv. A static import crashes when NitroModules is
 * missing (Expo Go / unlinked native builds). require() keeps that failure catchable.
 *
 * Expo Go: skip the require entirely — Nitro MMKV is not available and the
 * attempt can destabilize the JS runtime on some Android images.
 */
function resolveCreateMMKV(): CreateMMKV | null {
  if (createMMKVFn !== undefined) {
    return createMMKVFn;
  }

  if (isExpoGoRuntime()) {
    mmkvUnavailableReason = 'MMKV is unavailable in Expo Go';
    createMMKVFn = null;
    return null;
  }

  try {
    // eslint-disable-next-line @typescript-eslint/no-require-imports
    const mmkvModule = require('react-native-mmkv') as {
      createMMKV: CreateMMKV;
    };
    createMMKVFn = mmkvModule.createMMKV;
    return createMMKVFn;
  } catch (error) {
    mmkvUnavailableReason =
      error instanceof Error ? error.message : 'MMKV native module is unavailable';
    createMMKVFn = null;
    return null;
  }
}

export function isMmkvAvailable(): boolean {
  return getMmkvInstance() !== null;
}

export function getMmkvUnavailableReason(): string | null {
  return mmkvUnavailableReason;
}

export function getMmkvInstance(): MmkvInstance | null {
  if (mmkvInstance) {
    return mmkvInstance;
  }

  if (mmkvUnavailableReason) {
    return null;
  }

  const createMMKV = resolveCreateMMKV();

  if (!createMMKV) {
    return null;
  }

  try {
    mmkvInstance = createMMKV({ id: MMKV_INSTANCE_ID });
    return mmkvInstance;
  } catch (error) {
    mmkvUnavailableReason =
      error instanceof Error ? error.message : 'MMKV native module is unavailable';
    return null;
  }
}

export function requireMmkvInstance(): MmkvInstance {
  const instance = getMmkvInstance();

  if (!instance) {
    throw new StorageError(
      getMmkvUnavailableReason() ?? 'MMKV is unavailable',
      'MMKV_UNAVAILABLE',
    );
  }

  return instance;
}
