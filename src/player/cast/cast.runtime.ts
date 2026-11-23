/**
 * P13 #667: the app's side of the native `VidoraCast` module — its events into `cast-store.ts`, and the calls the
 * Player makes. Without the module (an older build, Node tests) every call does nothing and no device is ever found,
 * so the Cast button never shows.
 */

import { getVidoraCast } from '@modules/vidorax-media/src/VidoraCastModule';
import type { CastLoadRequest } from '@modules/vidorax-media/src/VidoraCast.types';

import {
  castConnected,
  castConnecting,
  castDevicesChanged,
  castDisconnected,
  castFailed,
  castLoading,
  castPositionChanged,
  castStateChanged,
  useCastStore,
} from './cast-store';

let bound = false;

function bindCastEvents(): void {
  const cast = getVidoraCast();
  if (bound || !cast) {
    return;
  }
  bound = true;
  const update = useCastStore.setState;
  const get = useCastStore.getState;
  cast.addListener('onCastDevices', ({ devices }) => update(castDevicesChanged(get(), devices ?? [])));
  cast.addListener('onCastConnected', ({ deviceName }) => update(castConnected(get(), deviceName)));
  cast.addListener('onCastDisconnected', (event) => update(castDisconnected(get(), event)));
  cast.addListener('onCastPosition', ({ positionMs, durationMs }) => update(castPositionChanged(get(), positionMs, durationMs)));
  cast.addListener('onCastState', (event) => update(castStateChanged(get(), event)));
  cast.addListener('onCastError', ({ code }) => update(castFailed(get(), code)));
}

function call(run: (cast: NonNullable<ReturnType<typeof getVidoraCast>>) => Promise<unknown>): void {
  const cast = getVidoraCast();
  if (!cast) {
    return;
  }
  bindCastEvents();
  void run(cast).catch(() => undefined);
}

let discoveryUsers = 0;

/** The Player screen opened: look for Cast devices until the returned function runs (the screen closed). */
export function holdCastDiscovery(): () => void {
  discoveryUsers += 1;
  if (discoveryUsers === 1) {
    call((cast) => cast.startCastDiscovery());
  }
  let held = true;
  return () => {
    if (!held) {
      return;
    }
    held = false;
    discoveryUsers = Math.max(0, discoveryUsers - 1);
    if (discoveryUsers === 0) {
      useCastStore.setState(castDevicesChanged(useCastStore.getState(), []));
      call((cast) => cast.stopCastDiscovery());
    }
  };
}

export function connectCastDevice(deviceId: string): void {
  useCastStore.setState(castConnecting(useCastStore.getState()));
  call((cast) => cast.connectCastDevice(deviceId));
}

export function loadOnCast(mediaId: string, request: CastLoadRequest): void {
  useCastStore.setState(castLoading(useCastStore.getState(), mediaId, request.positionMs));
  call((cast) => cast.castLoad(request));
}

export function castPlay(): void {
  call((cast) => cast.castPlay());
}

export function castPause(): void {
  call((cast) => cast.castPause());
}

export function castSeek(positionMs: number): void {
  useCastStore.setState({ positionMs: Math.max(0, positionMs) });
  call((cast) => cast.castSeek(Math.max(0, positionMs)));
}

export function castSetVolume(volume: number): void {
  call((cast) => cast.castSetVolume(Math.min(1, Math.max(0, volume))));
}

export function stopCasting(): void {
  call((cast) => cast.castStop());
}
