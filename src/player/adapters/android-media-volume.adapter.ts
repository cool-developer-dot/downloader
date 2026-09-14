import { NativeEventEmitter, NativeModules, Platform } from 'react-native';

const MODULE_NAME = 'VidoraMediaVolume';

export type MediaVolumeSnapshot = {
  level: number;
  current: number;
  max: number;
  available: boolean;
};

type MediaVolumeModuleShape = {
  getMediaVolume: () => Promise<MediaVolumeSnapshot>;
  setMediaVolume: (level: number) => Promise<MediaVolumeSnapshot>;
  addListener: (eventName: string) => void;
  removeListeners: (count: number) => void;
};

function normalizeSnapshot(raw: Partial<MediaVolumeSnapshot> | null | undefined): MediaVolumeSnapshot {
  const level =
    typeof raw?.level === 'number' && Number.isFinite(raw.level)
      ? Math.max(0, Math.min(1, raw.level))
      : 0;
  return {
    level,
    current: typeof raw?.current === 'number' ? raw.current : 0,
    max: typeof raw?.max === 'number' ? raw.max : 0,
    available: raw?.available !== false && Platform.OS === 'android',
  };
}

function getModule(): MediaVolumeModuleShape | null {
  if (Platform.OS !== 'android') {
    return null;
  }
  const mod = NativeModules[MODULE_NAME] as MediaVolumeModuleShape | undefined;
  if (!mod?.getMediaVolume || !mod?.setMediaVolume) {
    return null;
  }
  return mod;
}

export function isAndroidMediaVolumeAvailable(): boolean {
  return getModule() != null;
}

export async function readAndroidMediaVolume(): Promise<MediaVolumeSnapshot> {
  const mod = getModule();
  if (!mod) {
    return { level: 1, current: 0, max: 0, available: false };
  }
  try {
    const snapshot = await mod.getMediaVolume();
    return normalizeSnapshot(snapshot);
  } catch {
    return { level: 1, current: 0, max: 0, available: false };
  }
}

export async function writeAndroidMediaVolume(level: number): Promise<MediaVolumeSnapshot> {
  const mod = getModule();
  if (!mod) {
    return { level: 1, current: 0, max: 0, available: false };
  }
  const clamped = Math.max(0, Math.min(1, level));
  try {
    const snapshot = await mod.setMediaVolume(clamped);
    return normalizeSnapshot(snapshot);
  } catch {
    return readAndroidMediaVolume();
  }
}

export function subscribeAndroidMediaVolume(
  listener: (snapshot: MediaVolumeSnapshot) => void,
): () => void {
  const mod = getModule();
  if (!mod) {
    return () => {};
  }

  const emitter = new NativeEventEmitter(
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    mod as any,
  );
  const subscription = emitter.addListener('onMediaVolumeChanged', (payload: MediaVolumeSnapshot) => {
    listener(normalizeSnapshot(payload));
  });

  return () => {
    subscription.remove();
  };
}
