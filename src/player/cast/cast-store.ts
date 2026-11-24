/**
 * P13 #667: what the Player knows about casting, fed by the native `VidoraCast` events (`cast.runtime.ts`). The
 * reducers are pure, so they are unit tested; the store itself has no native code.
 */

import type {
  CastDevice,
  CastDisconnectReason,
  CastErrorCode,
  CastMediaState,
} from '@modules/vidorax-media/src/VidoraCast.types';

import { createStore } from '@/store/shared/create-store';

export type CastConnection = 'idle' | 'connecting' | 'connected';

export type CastDisconnect = {
  reason: CastDisconnectReason;
  positionMs: number | null;
  finished: boolean;
  /** The Player's video that was on the TV (null: nothing had been loaded). */
  mediaId: string | null;
  /** Increases with every disconnect, so a screen reacts to each one once. */
  seq: number;
};

export type CastState = {
  devices: readonly CastDevice[];
  connection: CastConnection;
  deviceName: string | null;
  media: CastMediaState;
  positionMs: number | null;
  durationMs: number | null;
  volume: number | null;
  /** The Player's video loaded on the TV; null before the first load of a cast. */
  castMediaId: string | null;
  lastDisconnect: CastDisconnect | null;
  lastError: { code: CastErrorCode; seq: number } | null;
};

export const INITIAL_CAST_STATE: CastState = {
  devices: [],
  connection: 'idle',
  deviceName: null,
  media: 'idle',
  positionMs: null,
  durationMs: null,
  volume: null,
  castMediaId: null,
  lastDisconnect: null,
  lastError: null,
};

export const useCastStore = createStore<CastState>()(() => INITIAL_CAST_STATE);

function finite(value: number | null | undefined): number | null {
  return typeof value === 'number' && Number.isFinite(value) && value >= 0 ? value : null;
}

export function castDevicesChanged(state: CastState, devices: readonly CastDevice[]): CastState {
  return { ...state, devices: devices.filter((d) => typeof d?.id === 'string' && d.id.length > 0) };
}

export function castConnecting(state: CastState): CastState {
  return state.connection === 'connected' ? state : { ...state, connection: 'connecting' };
}

export function castConnected(state: CastState, deviceName: string): CastState {
  return {
    ...state,
    connection: 'connected',
    deviceName: deviceName || state.deviceName,
    media: 'idle',
    positionMs: null,
    durationMs: null,
    castMediaId: null,
  };
}

export function castLoading(state: CastState, mediaId: string, positionMs: number): CastState {
  return { ...state, castMediaId: mediaId, media: 'buffering', positionMs, durationMs: null };
}

export function castPositionChanged(state: CastState, positionMs: number, durationMs: number | null): CastState {
  if (state.connection !== 'connected') {
    return state;
  }
  return { ...state, positionMs: finite(positionMs) ?? state.positionMs, durationMs: finite(durationMs) ?? state.durationMs };
}

export function castStateChanged(
  state: CastState,
  event: { state: CastMediaState; positionMs: number | null; durationMs: number | null; volume: number | null },
): CastState {
  if (event.state === 'connecting') {
    return castConnecting(state);
  }
  if (state.connection !== 'connected') {
    return state;
  }
  return {
    ...state,
    media: event.state,
    positionMs: finite(event.positionMs) ?? state.positionMs,
    durationMs: finite(event.durationMs) ?? state.durationMs,
    volume: typeof event.volume === 'number' && Number.isFinite(event.volume) ? event.volume : state.volume,
  };
}

export function castDisconnected(
  state: CastState,
  event: { reason: CastDisconnectReason; positionMs: number | null; finished: boolean },
): CastState {
  return {
    ...state,
    connection: 'idle',
    deviceName: null,
    media: 'idle',
    positionMs: null,
    durationMs: null,
    volume: null,
    castMediaId: null,
    lastDisconnect: {
      reason: event.reason,
      positionMs: finite(event.positionMs) ?? state.positionMs,
      finished: event.finished,
      mediaId: state.castMediaId,
      seq: (state.lastDisconnect?.seq ?? 0) + 1,
    },
  };
}

export function castFailed(state: CastState, code: CastErrorCode): CastState {
  const failedToConnect = code === 'connect_failed' || code === 'device_gone' || code === 'unavailable';
  return {
    ...state,
    connection: failedToConnect && state.connection === 'connecting' ? 'idle' : state.connection,
    lastError: { code, seq: (state.lastError?.seq ?? 0) + 1 },
  };
}

/** The TV plays (or loads) this video now. */
export function isCastingMedia(state: Pick<CastState, 'connection' | 'castMediaId'>, mediaId: string | null): boolean {
  return state.connection === 'connected' && mediaId != null && state.castMediaId === mediaId;
}
