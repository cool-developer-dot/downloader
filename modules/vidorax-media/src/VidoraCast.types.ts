/**
 * P13 #667 Chromecast: the `VidoraCast` native module (android/…/cast/VidoraCastModule.kt).
 *
 * Discovery runs only while the Player screen asks for it. A local file reaches the TV through the phone's own
 * server (cast/CastFileServer.kt), which runs only while that file is cast, on the Wi-Fi address, at a URL with a
 * random 128-bit token.
 */

export type CastDevice = {
  /** MediaRouter's route id (stable while the device is visible). */
  id: string;
  /** The name the TV or Chromecast gives itself ("Living Room TV"). */
  name: string;
  description: string | null;
};

export type CastMediaState = 'idle' | 'buffering' | 'playing' | 'paused' | 'finished' | 'connecting';

/** Why a cast ended: the user stopped it, the TV ended it, the connection dropped, or it never connected. */
export type CastDisconnectReason = 'stopped' | 'ended' | 'dropped' | 'failed';

export type CastErrorCode =
  | 'unavailable'
  | 'device_gone'
  | 'connect_failed'
  | 'not_connected'
  | 'no_wifi'
  | 'private'
  | 'still_downloading'
  | 'stream_unsupported'
  | 'file_unavailable'
  | 'server_failed'
  | 'load_failed'
  | 'playback_failed'
  | 'volume_failed';

export type CastLoadRequest = {
  /** What the Player plays: `file://`, `content://` (served by the phone) or an `http(s)://` stream (sent as is). */
  uri: string;
  contentType: string | null;
  title: string;
  positionMs: number;
  autoplay: boolean;
  /** The chosen subtitle file as WebVTT text, or null for none. */
  subtitleVtt: string | null;
  subtitleLanguage: string | null;
  subtitleLabel: string | null;
};

export type CastStatus = {
  available: boolean;
  connected: boolean;
  deviceName: string | null;
  state: CastMediaState;
  positionMs: number | null;
  durationMs: number | null;
  volume: number | null;
  /** The local server is running (only while a local file is cast). */
  serving: boolean;
};

export type VidoraCastEvents = {
  onCastDevices: (event: { devices: CastDevice[] }) => void;
  onCastConnected: (event: { deviceName: string }) => void;
  onCastDisconnected: (event: { reason: CastDisconnectReason; positionMs: number | null; finished: boolean }) => void;
  onCastPosition: (event: { positionMs: number; durationMs: number | null }) => void;
  onCastState: (event: {
    state: CastMediaState;
    positionMs: number | null;
    durationMs: number | null;
    volume: number | null;
  }) => void;
  onCastError: (event: { code: CastErrorCode; message: string }) => void;
};

export type VidoraCastModuleApi = {
  isCastAvailable(): Promise<boolean>;
  startCastDiscovery(): Promise<void>;
  stopCastDiscovery(): Promise<void>;
  getCastDevices(): Promise<CastDevice[]>;
  connectCastDevice(deviceId: string): Promise<void>;
  castLoad(request: CastLoadRequest): Promise<void>;
  castPlay(): Promise<void>;
  castPause(): Promise<void>;
  castSeek(positionMs: number): Promise<void>;
  /** The TV's own volume, 0–1. */
  castSetVolume(volume: number): Promise<void>;
  /** Stops the TV, ends the session and stops the phone's server. */
  castStop(): Promise<void>;
  getCastStatus(): Promise<CastStatus>;
};
