/**
 * Shared domain contracts used by local catalog / analyze / playback.
 * Date fields are ISO-8601 strings.
 */

export type ThemeMode = 'SYSTEM' | 'LIGHT' | 'LOGO' | 'DARK';

export interface Settings {
  theme: ThemeMode;
  language: string;
  notificationsEnabled: boolean;
  wifiOnlyDownloads: boolean;
  autoResumeDownloads: boolean;
  downloadDirectory: string;
}

export interface SettingsResponse {
  settings: Settings;
}

export interface UpdateSettingsRequest {
  theme?: ThemeMode;
  language?: string;
  notificationsEnabled?: boolean;
  wifiOnlyDownloads?: boolean;
  autoResumeDownloads?: boolean;
  downloadDirectory?: string;
}

export type HistoryListSort = 'newest' | 'oldest' | 'alphabetical';

export interface BrowserHistoryItem {
  id: string;
  url: string;
  title: string;
  hostname: string;
  visitedAt: string;
  createdAt: string;
}

export interface HistoryPagination {
  total: number;
  page: number;
  limit: number;
  totalPages: number;
  offset: number;
  hasMore: boolean;
}

export interface HistoryListResponse {
  items: BrowserHistoryItem[];
  pagination: HistoryPagination;
}

export interface ListHistoryParams {
  page?: number;
  limit?: number;
  search?: string;
  hostname?: string;
  sort?: HistoryListSort;
}

export interface CreateHistoryRequest {
  url: string;
  title: string;
  visitedAt?: string;
}

export interface CreateHistoryResponse {
  history: BrowserHistoryItem;
}

export interface RecentUrlItem {
  url: string;
  title: string;
  hostname: string;
  visitedAt: string;
}

export interface RecentUrlsResponse {
  urls: RecentUrlItem[];
}

export interface ClearHistoryResponse {
  deletedCount: number;
}

export interface DeleteHistoryResponse {
  message: string;
}

export type BookmarkListSort = 'newest' | 'oldest' | 'alphabetical';

export interface BookmarkItem {
  id: string;
  url: string;
  title: string;
  hostname: string;
  faviconUrl: string | null;
  createdAt: string;
}

export interface BookmarkListResponse {
  items: BookmarkItem[];
  pagination: HistoryPagination;
}

export interface ListBookmarksParams {
  page?: number;
  limit?: number;
  search?: string;
  sort?: BookmarkListSort;
}

export interface CreateBookmarkRequest {
  url: string;
  title: string;
  faviconUrl?: string | null;
}

export interface CreateBookmarkResponse {
  bookmark: BookmarkItem;
}

export interface UpdateBookmarkRequest {
  url?: string;
  title?: string;
  faviconUrl?: string | null;
}

export interface UpdateBookmarkResponse {
  bookmark: BookmarkItem;
}

export interface DeleteBookmarkResponse {
  message: string;
}

export interface ClearBookmarksResponse {
  deletedCount: number;
}

/** Backend DownloadStatus enum — do not invent additional values. */
export type DownloadStatus =
  | 'QUEUED'
  | 'DOWNLOADING'
  | 'PAUSED'
  | 'COMPLETED'
  | 'FAILED'
  | 'CANCELLED';

/** Canonical operational worker lifecycle — distinct from DownloadStatus. */
export type DownloadWorkerState =
  | 'IDLE'
  | 'WAITING'
  | 'STARTING'
  | 'TRANSFERRING'
  | 'PAUSING'
  | 'PAUSED'
  | 'RETRY_WAIT'
  | 'VERIFYING'
  | 'COMPLETING'
  | 'COMPLETED'
  | 'FAILED'
  | 'CANCELLED';

export type DownloadListSort = 'newest' | 'oldest' | 'alphabetical';

export interface DownloadItem {
  id: string;
  userId: string;
  title: string;
  sourceUrl: string;
  platform: string;
  thumbnailUrl: string;
  fileName: string;
  /** Logical organization bucket for this completed media record. */
  folderId: string | null;
  /** BigInt serialized as decimal string */
  fileSize: string;
  status: DownloadStatus;
  /** Integer 0–100 */
  progress: number;
  /** Selected quality label when known; null for legacy rows. */
  quality: string | null;
  /** Selected resolution WIDTHxHEIGHT when known. */
  resolution: string | null;
  /** Selected bitrate bits/sec when known. */
  bitrate: number | null;
  /**
   * Phase 7A completed MIME when known (catalog mime_type).
   * Null for legacy rows — never fabricate.
   */
  mimeType: string | null;
  /**
   * Phase 7A completed container hint (mp4/webm/ts/m4a/unknown).
   * Derived at completion; null for legacy rows.
   */
  container: string | null;
  /** Durable transfer retry attempts for this job lifecycle. */
  retryCount: number;
  /** Durable operational worker milestone. */
  workerState: DownloadWorkerState | null;
  /** Stable engine-style failure code when status is FAILED */
  errorCode: string | null;
  errorMessage: string | null;
  downloadedAt: string | null;
  createdAt: string;
  updatedAt: string;
}

export interface DownloadListResponse {
  items: DownloadItem[];
  pagination: HistoryPagination;
}

export interface ListDownloadsParams {
  page?: number;
  limit?: number;
  search?: string;
  status?: DownloadStatus;
  platform?: string;
  sort?: DownloadListSort;
}

export interface CreateDownloadRequest {
  title: string;
  sourceUrl: string;
  platform: string;
  thumbnailUrl: string;
  fileName: string;
  fileSize: string | number;
  quality?: string | null;
  resolution?: string | null;
  bitrate?: number | null;
}

export interface CreateDownloadResponse {
  download: DownloadItem;
}

export interface UpdateDownloadRequest {
  progress?: number;
  status?: DownloadStatus;
  fileName?: string;
  fileSize?: string | number;
  thumbnailUrl?: string;
  errorCode?: string | null;
  errorMessage?: string | null;
  /** Durable worker milestone — must be compatible with resulting status. */
  workerState?: DownloadWorkerState | null;
}

export interface UpdateDownloadResponse {
  download: DownloadItem;
}

export interface GetDownloadResponse {
  download: DownloadItem;
}

export interface DeleteDownloadResponse {
  message: string;
}

export type MediaAnalysisMediaType = 'video' | 'audio' | 'stream';

export type MediaAnalysisContainer =
  | 'mp4'
  | 'webm'
  | 'mov'
  | 'm4v'
  | 'mp3'
  | 'm4a'
  | 'aac'
  | 'ogg'
  | 'hls'
  | 'unknown';

export type MediaAnalysisStreamType =
  | 'PROGRESSIVE'
  | 'HLS'
  | 'AUDIO'
  | 'UNKNOWN';

export type AnalysisUnsupportedReason =
  | 'INVALID_URL'
  | 'NO_MEDIA'
  | 'UNSUPPORTED_FORMAT'
  | 'UNSUPPORTED_STREAM'
  | 'DRM_PROTECTED'
  | 'ENCRYPTED_MEDIA'
  | 'NETWORK_ERROR'
  | 'ANALYSIS_FAILED';

/** One real downloadable variant from Analyze — never fabricated. */
export interface MediaAnalysisVariant {
  id: string;
  sourceUrl: string;
  streamType: MediaAnalysisStreamType;
  label: string | null;
  resolution: string | null;
  width: number | null;
  height: number | null;
  bitrate: number | null;
  averageBitrate: number | null;
  videoBitrate: number | null;
  audioBitrate: number | null;
  codecs: string | null;
  videoCodec: string | null;
  audioCodec: string | null;
  container: MediaAnalysisContainer;
  mimeType: string | null;
  estimatedFileSize: number | null;
  frameRate: number | null;
  downloadable: boolean;
  unsupportedReason: AnalysisUnsupportedReason | null;
}

/** Response from POST /downloads/analyze — does not create DownloadHistory. */
export interface MediaAnalysisResult {
  title: string | null;
  sourceUrl: string;
  finalUrl: string;
  thumbnailUrl: string | null;
  mediaType: MediaAnalysisMediaType | null;
  mimeType: string | null;
  container: MediaAnalysisContainer;
  duration: number | null;
  width: number | null;
  height: number | null;
  resolution: string | null;
  bitrate: number | null;
  fps: number | null;
  fileSize: string | null;
  platform: string;
  downloadable: boolean;
  unsupportedReason: AnalysisUnsupportedReason | null;
  /** Canonical multi-quality variants (additive Week 7 field). */
  variants?: MediaAnalysisVariant[];
}

export interface AnalyzeDownloadRequest {
  url: string;
}

export interface AnalyzeDownloadResponse {
  analysis: MediaAnalysisResult;
}

/** Backend FavoritePlatform enum — do not invent additional values. */
export type FavoritePlatform =
  | 'YOUTUBE'
  | 'FACEBOOK'
  | 'INSTAGRAM'
  | 'TIKTOK'
  | 'X'
  | 'VIMEO'
  | 'DAILYMOTION'
  | 'OTHER';

export type FavoriteListSort = 'newest' | 'oldest' | 'alphabetical';

export interface FavoriteItem {
  id: string;
  userId: string;
  title: string;
  platform: FavoritePlatform;
  sourceUrl: string;
  thumbnailUrl: string;
  createdAt: string;
}

export interface FavoriteListResponse {
  items: FavoriteItem[];
  pagination: HistoryPagination;
}

export interface ListFavoritesParams {
  page?: number;
  limit?: number;
  search?: string;
  platform?: FavoritePlatform;
  sort?: FavoriteListSort;
}

export interface CreateFavoriteRequest {
  title: string;
  platform: FavoritePlatform;
  sourceUrl: string;
  thumbnailUrl: string;
}

export interface CreateFavoriteResponse {
  favorite: FavoriteItem;
}

export interface DeleteFavoriteResponse {
  message: string;
}

// Media folder organization DTOs.
export interface MediaFolderItem {
  id: string;
  name: string;
  createdAt: string;
  updatedAt: string;
}

export interface ListMediaFoldersResponse {
  items: MediaFolderItem[];
}

export interface CreateMediaFolderInput {
  name: string;
}

export interface CreateMediaFolderResponse {
  folder: MediaFolderItem;
}

export interface PatchMediaFolderRenameInput {
  name: string;
}

export interface PatchMediaFolderRenameResponse {
  folder: MediaFolderItem;
}

export interface PatchMediaRenameRequest {
  displayName: string;
}

export interface PatchMediaRenameResponse {
  id: string;
  title: string;
  fileName: string;
}

export interface DeleteMediaResponse {
  deleted: boolean;
}

export interface DeleteMediaFolderResponse {
  message: string;
}

export interface PatchMediaFavoriteRequest {
  favorite: boolean;
}

export interface PatchMediaFavoriteResponse {
  favorite: boolean;
}

export interface PatchMediaFolderAssignmentRequest {
  folderId: string | null;
}

export interface PatchMediaFolderAssignmentResponse {
  folderId: string | null;
  folderName: string | null;
}

export interface ApiSuccessResponse<T> {
  success: true;
  data: T;
}

export type MediaLibrarySort =
  | 'newest'
  | 'oldest'
  | 'name_asc'
  | 'name_desc'
  | 'largest'
  | 'smallest';

export interface MediaLibraryRemoteItem {
  id: string;
  downloadId: string;
  displayName: string;
  fileName: string;
  mimeType: string | null;
  fileSize: string;
  quality: string | null;
  resolution: string | null;
  bitrate: number | null;
  duration: number | null;
  downloadedAt: string | null;
  favorite: boolean;
  folderId: string | null;
  folderName: string | null;
  thumbnailUrl: string | null;
}

export interface MediaLibraryListResponse {
  items: MediaLibraryRemoteItem[];
  pagination: HistoryPagination;
}

export interface GetMediaLibraryItemResponse {
  media: MediaLibraryRemoteItem;
}

export interface ListMediaLibraryParams {
  page?: number;
  limit?: number;
  sort?: MediaLibrarySort;
  favorite?: boolean;
  folderId?: string;
}

/** Week 8 Day 3 — durable playback progress DTO (safe metadata only). */
export interface PlaybackRemoteDto {
  mediaId: string;
  positionSeconds: number;
  durationSeconds: number;
  progressPercent: number;
  lastPlayedAt: string | null;
  completed: boolean;
  updatedAt: string;
  /** Server-stored client revision for stale-write protection. */
  clientRevision?: number;
}

export interface GetPlaybackResponse {
  playback: PlaybackRemoteDto;
}

export interface UpdatePlaybackProgressRequest {
  positionSeconds: number;
  durationSeconds: number;
  updatedAt?: string;
  lastPlayedAt?: string | null;
  markCompleted?: boolean;
  replayReset?: boolean;
  clientRevision?: number;
}

export interface UpdatePlaybackProgressResponse {
  playback: PlaybackRemoteDto;
}

export interface PlaybackListResponse {
  items: PlaybackRemoteDto[];
  pagination: HistoryPagination;
}

export interface PlaybackRecentResponse {
  items: PlaybackRemoteDto[];
}

export interface DeletePlaybackResponse {
  deleted: boolean;
}

export interface ListPlaybackParams {
  page?: number;
  limit?: number;
}

export interface ValidationError {
  type: string;
  msg: string;
  path: string;
  location: string;
  value?: string | number | boolean | null;
}

export interface ApiErrorBody {
  success: false;
  error: string;
  details?: ValidationError[];
}

export type ApiResponse<T> = ApiSuccessResponse<T> | ApiErrorBody;

export type ApiErrorCode =
  | 'UNAUTHORIZED'
  | 'FORBIDDEN'
  | 'VALIDATION_ERROR'
  | 'NOT_FOUND'
  | 'CONFLICT'
  | 'SERVER_ERROR'
  | 'TIMEOUT'
  | 'NETWORK_ERROR'
  | 'UNEXPECTED_RESPONSE'
  | 'UNKNOWN';
