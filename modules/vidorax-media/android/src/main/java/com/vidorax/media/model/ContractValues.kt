package com.vidorax.media.model

/**
 * A string union of the JavaScript contract (src/VidoraMedia.types.ts). [wire] is the exact string used in
 * JavaScript and stored in the database.
 */
interface WireEnum {
  val wire: String
}

inline fun <reified T> wireValueOf(wire: String): T? where T : Enum<T>, T : WireEnum =
  enumValues<T>().firstOrNull { it.wire == wire }

enum class SourceKind(override val wire: String) : WireEnum {
  PROGRESSIVE("progressive"),
  HLS("hls"),

  /**
   * An MPD (VOD, unprotected, one period): the chosen video representation — one file or init + segments — and, when
   * the stream keeps its sound in a separate adaptation set, one audio representation, merged into one file.
   */
  DASH("dash"),

  /**
   * One video file and one audio file of the same video (a player fed from separate tracks, e.g. MediaSource with a
   * video and an audio SourceBuffer): both are downloaded, verified and merged into one file.
   */
  SPLIT("split"),
}

enum class SiteId(override val wire: String, val folderName: String) : WireEnum {
  INSTAGRAM("instagram", "Instagram"),
  FACEBOOK("facebook", "Facebook"),
  TIKTOK("tiktok", "TikTok"),
  TWITTER("twitter", "X"),
  REDDIT("reddit", "Reddit"),
  VIMEO("vimeo", "Vimeo"),
  DAILYMOTION("dailymotion", "Dailymotion"),
  TWITCH("twitch", "Twitch"),
  PINTEREST("pinterest", "Pinterest"),
  SNAPCHAT("snapchat", "Snapchat"),
  LINKEDIN("linkedin", "LinkedIn"),
  WEB("web", "Web"),
}

enum class Container(override val wire: String) : WireEnum {
  MP4("mp4"),
  WEBM("webm"),
  MOV("mov"),
  AVI("avi"),
  WMV("wmv"),
  MKV("mkv"),
  TS("ts"),
  FLV("flv"),
  THREE_GP("3gp"),
  /** 3GPP2 (`ftyp 3g2*`): ISO-BMFF, kept as `.3g2` / `video/3gpp2`. */
  THREE_G2("3g2"),
  UNKNOWN("unknown"),
}

enum class DownloadState(override val wire: String) : WireEnum {
  QUEUED("queued"),
  PROBING("probing"),
  DOWNLOADING("downloading"),
  PAUSED("paused"),
  WAITING_NETWORK("waiting_network"),
  WAITING_RETRY("waiting_retry"),
  PROCESSING("processing"),
  COMPLETED("completed"),
  FAILED("failed"),
  CANCELLED("cancelled"),
}

enum class DownloadErrorCode : WireEnum {
  NETWORK,
  HTTP_403,
  HTTP_404,
  HTTP_ERROR,
  SOURCE_EXPIRED,
  DRM_PROTECTED,
  LIVE_UNSUPPORTED,
  UNSUPPORTED_FORMAT,
  NOT_MEDIA,
  PROCESSING_FAILED,
  NO_SPACE,
  STORAGE_ERROR,
  /** The finished file is byte-for-byte a video the user already has: it was discarded, nothing was added. */
  DUPLICATE,
  UNKNOWN,

  /** A split download's "video" file has no video track. */
  VIDEO_TRACK_MISSING,

  /** A stream or split download's audio track is missing (the audio file or rendition has no sound). */
  AUDIO_TRACK_MISSING,

  /** The video and audio tracks do not belong to the same video (their durations disagree). */
  TRACK_MISMATCH,

  /** A segment of an HLS/DASH stream could not be downloaded (missing on the server, refused, malformed). */
  SEGMENT_FAILED,

  /** Merging or re-containering the downloaded tracks failed. */
  MUX_FAILED,

  /** Converting a track the output container cannot hold failed (no decoder/encoder, codec error). */
  TRANSCODE_FAILED,

  /** The finished file is not the media it should be (unreadable, wrong duration, a track missing after merging). */
  INVALID_MEDIA,
  ;

  override val wire: String get() = name
}

enum class ProbeFailure : WireEnum {
  DRM_PROTECTED,
  LIVE_UNSUPPORTED,
  UNSUPPORTED_FORMAT,
  NOT_MEDIA,
  HTTP_403,
  HTTP_404,
  HTTP_ERROR,
  NETWORK,
  POLICY_BLOCKED,

  /** Split source: the video file has no video track. */
  VIDEO_TRACK_MISSING,

  /** Split source: the audio file has no audio track. */
  AUDIO_TRACK_MISSING,

  /** Split source: the two files are not tracks of the same video. */
  TRACK_MISMATCH,
  ;

  override val wire: String get() = name
}

enum class ProgressPhase(override val wire: String) : WireEnum {
  DOWNLOAD("download"),
  PROCESSING("processing"),
}

/** What the `processing` phase is doing right now (progress events only; never persisted). */
enum class ProcessingStage(override val wire: String) : WireEnum {
  /** Separately downloaded video and audio are written into one file. */
  MERGING("merging"),

  /** The tracks are moved into a better container without re-encoding (e.g. MPEG-TS or fragmented MP4 → MP4). */
  REMUXING("remuxing"),

  /** A track the output container cannot hold is re-encoded. */
  TRANSCODING("transcoding"),

  /** The finished file is checked before it enters the library. */
  VERIFYING("verifying"),
}

enum class LibrarySort(override val wire: String) : WireEnum {
  NEWEST("newest"),
  OLDEST("oldest"),
  TITLE("title"),
  LARGEST("largest"),
  LONGEST("longest"),
}

enum class LibraryChangeReason(override val wire: String) : WireEnum {
  ADDED("added"),
  UPDATED("updated"),
  DELETED("deleted"),
  IMPORTED("imported"),
}
