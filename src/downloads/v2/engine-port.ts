import { getVidoraMedia, isVidoraMediaAvailable } from '@modules/vidorax-media';
import type {
  CompletedDownload,
  DeviceVideoPage,
  DownloadCredentials,
  DownloadRecord,
  DownloadSettings,
  EnqueueRequest,
  EnqueueResult,
  LibraryItem,
  LibraryPage,
  LibraryQuery,
  PageFetchRequest,
  PageFetchResult,
  ProbeRequest,
  ProbeResult,
  VidoraMediaEvents,
} from '@modules/vidorax-media/src/VidoraMedia.types';

/**
 * The part of the native `VidoraMedia` module the browser handoff, Downloads and Library use. The v2 DownloadEngine
 * behind it is the single downloader and the single persisted download state; JavaScript only mirrors it.
 */
export type V2EnginePort = {
  /** The native classifier: DOWNLOADABLE, or why not (protected, live, unsupported, or a transient failure). */
  probe(request: ProbeRequest): Promise<ProbeResult>;
  /** Reads a pasted/shared link's page for the direct analyzer. Missing on older native builds (no direct analysis). */
  fetchPage?(request: PageFetchRequest): Promise<PageFetchResult>;
  enqueue(request: EnqueueRequest): Promise<DownloadRecord>;
  /** One download per video (atomic duplicate check). Missing on older native builds: `enqueue` is used then. */
  enqueueUnique?(request: EnqueueRequest): Promise<EnqueueResult>;
  /** The duplicate check alone, before any network request. Missing on older native builds. */
  findDuplicate?(request: EnqueueRequest): Promise<EnqueueResult | null>;
  pause(id: string): Promise<void>;
  resume(id: string): Promise<void>;
  /** H4 queues and start order (see `VidoraMediaModuleApi`). Missing on older native builds: no Reorder mode then. */
  getDownloadQueues?(): Promise<import('@modules/vidorax-media/src/VidoraMedia.types').DownloadQueueState>;
  setDownloadOrder?(ids: string[]): Promise<import('@modules/vidorax-media/src/VidoraMedia.types').DownloadQueueState>;
  moveDownloadsToQueue?(
    ids: string[],
    queueId: string,
  ): Promise<import('@modules/vidorax-media/src/VidoraMedia.types').DownloadQueueState>;
  setDownloadQueues?(
    queues: import('@modules/vidorax-media/src/VidoraMedia.types').DownloadQueue[],
  ): Promise<import('@modules/vidorax-media/src/VidoraMedia.types').DownloadQueueState>;
  retry(id: string): Promise<void>;
  /** #299: where a download started with sign-in must sign in again; null when not needed. Older builds: missing. */
  downloadNeedsCredentials?(id: string): { origin: string; realm: string | null } | null;
  /** #299: the credentials again for such a download (never read back). Older builds: missing. */
  setDownloadCredentials?(id: string, credentials: DownloadCredentials): Promise<boolean>;
  cancel(id: string): Promise<void>;
  removeDownload(id: string): Promise<void>;
  /** Pauses every pausable download (the engine's own). Missing on older native builds: per-item `pause` then. */
  pauseAll?(): Promise<void>;
  /** Resumes every paused download (the engine's own). Missing on older native builds: per-item `resume` then. */
  resumeAll?(): Promise<void>;
  listDownloads(): Promise<DownloadRecord[]>;
  listLibrary(query: LibraryQuery): Promise<LibraryPage>;
  getLibraryItem(id: string): Promise<LibraryItem | null>;
  /** H19 Subtitles (see subtitles.types.ts). Missing on older native builds: no subtitles then. */
  probeSubtitles?(request: ProbeRequest): Promise<import('@modules/vidorax-media/src/subtitles.types').SubtitleTrackInfo[]>;
  setDownloadSubtitles?(id: string, trackIds: string[]): Promise<void>;
  getDownloadSubtitles?(id: string): Promise<import('@modules/vidorax-media/src/subtitles.types').DownloadSubtitles | null>;
  readSubtitle?(id: string, index: number): Promise<string>;
  shareSubtitleText?(fileName: string, text: string): Promise<void>;
  getLibraryItems(ids: string[]): Promise<LibraryItem[]>;
  deleteLibraryItems(ids: string[]): Promise<void>;
  /** Changes a library item's title (the file keeps its name). Missing on older native builds. */
  renameLibraryItem?(id: string, title: string): Promise<LibraryItem>;
  openWith(id: string): Promise<void>;
  share(ids: string[]): Promise<void>;
  saveToGallery(ids: string[]): Promise<void>;
  /** The item's thumbnail as a JPEG in Pictures/VidoraX. Missing on older native builds: the action is hidden. */
  saveThumbnailToGallery?(id: string): Promise<string>;
  setDownloadSettings(settings: DownloadSettings): Promise<void>;
  setFavorite(id: string, favorite: boolean): Promise<void>;
  /** Missing on older native builds; callers check before use. */
  listDeviceVideos?(limit: number, offset: number): Promise<DeviceVideoPage>;
  /**
   * Removes library items whose file is gone or empty (changed outside VidoraX) and resolves with their ids; the
   * engine announces them as `deleted`. Missing on older native builds; callers check before use.
   */
  reconcileLibrary?(ids?: string[] | null): Promise<string[]>;
  /**
   * Applies titles/sites/pages/favorites to library items (the v1 migration contract); waits for the native import of
   * v1 files first. Only `favorite: true` is ever sent from JavaScript.
   */
  applyLegacyMetadata?(entries: { id: string; favorite?: boolean }[]): Promise<void>;
  /** Completions not yet counted by JavaScript, oldest first. Missing on older native builds. */
  listCompletedDownloads?(): Promise<CompletedDownload[]>;
  acknowledgeCompletedDownloads?(ids: string[]): Promise<void>;
  addListener<EventName extends keyof VidoraMediaEvents>(
    eventName: EventName,
    listener: VidoraMediaEvents[EventName],
  ): { remove(): void };
};

let override: V2EnginePort | null = null;

/** Null when the installed build has no `VidoraMedia` module (never silently falls back to v1). */
export function getV2Engine(): V2EnginePort | null {
  if (override) {
    return override;
  }
  return isVidoraMediaAvailable() ? getVidoraMedia() : null;
}

export function setV2EngineForTests(port: V2EnginePort | null): void {
  override = port;
}
