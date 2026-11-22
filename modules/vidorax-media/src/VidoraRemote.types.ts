/**
 * Contract of the `VidoraRemote` native module (P6: Remote control #439/#438, Send to computer #511, Automation API
 * #499), implemented by android/.../remote/VidoraRemoteModule.kt. Everything stays on the phone and the local network.
 */

/** Why Remote control is off after it ran. */
export type RemoteStopReason = 'user' | 'idle' | 'wifi_lost' | 'background' | 'error';

export type RemoteClient = {
  id: string;
  /** What the browser called itself when it paired ("Chrome on macOS", "vidorax-cli"). */
  name: string;
  createdAt: number;
  lastSeenAt: number;
};

export type RemoteStatus = {
  running: boolean;
  /** `http://<Wi-Fi address>:<port>` while running. */
  url: string | null;
  address: string | null;
  port: number | null;
  /** The 6-digit pairing PIN while running; null when withdrawn after too many wrong PINs. */
  pin: string | null;
  /** Epoch ms until which pairing is locked after wrong PINs. */
  lockedUntil: number | null;
  /** Too many wrong PINs: no PIN until the user asks for a new one. */
  pinWithdrawn: boolean;
  /** Set once it stopped by itself (or was turned off). */
  stopReason: RemoteStopReason | null;
  /** When it stops for lack of requests (epoch ms), while running. */
  idleStopsAt: number | null;
  clients: RemoteClient[];
};

export type RemoteLinkSource = 'web' | 'extension' | 'cli' | 'automation';

/** A link from the Web UI, the browser extension, the CLI or another app, for the app's Batch Add path. */
export type RemoteLinkRequest = {
  requestId: string;
  url: string;
  source: RemoteLinkSource;
  createdAt: number;
};

/** What Batch Add made of it (`BatchOutcome`). */
export type RemoteLinkOutcome = 'added' | 'duplicate' | 'needs-review' | 'refused';

export type SentToComputerItem = {
  id: string;
  title: string;
  url: string | null;
  /** A finished video the computer can download from the phone. */
  hasFile: boolean;
  sizeBytes: number | null;
  sentAt: number;
};

export type VidoraRemoteEvents = {
  onRemoteStatus: (status: RemoteStatus) => void;
  onLinkRequest: (request: RemoteLinkRequest) => void;
};

export type VidoraRemoteModuleApi = {
  getRemoteStatus(): Promise<RemoteStatus>;
  /** Rejects with ERR_NO_WIFI off Wi-Fi, ERR_REMOTE_START when no port opens. */
  startRemoteControl(): Promise<RemoteStatus>;
  stopRemoteControl(): Promise<RemoteStatus>;
  newRemotePin(): Promise<RemoteStatus>;
  forgetRemoteClient(id: string): Promise<RemoteStatus>;
  forgetAllRemoteClients(): Promise<RemoteStatus>;
  reportLinkResult(
    requestId: string,
    outcome: RemoteLinkOutcome,
    title: string | null,
    downloadId: string | null,
    detail: string | null,
  ): Promise<boolean>;
  /** Null when there was neither an http(s) link nor a finished video to send. */
  sendToComputer(url: string | null, title: string, downloadId: string | null): Promise<SentToComputerItem | null>;
  listSentToComputer(): Promise<SentToComputerItem[]>;
  removeSentToComputer(id: string): Promise<boolean>;
  clearSentToComputer(): Promise<void>;
  getAllowOtherApps(): Promise<boolean>;
  setAllowOtherApps(allowed: boolean): Promise<void>;
};
