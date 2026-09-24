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
   * An MPD. Downloadable only when the chosen representation is one complete file (muxed audio and video, or video
   * in a manifest without audio); it is then fetched as that progressive file. Everything else is refused.
   */
  DASH("dash"),
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
  UNKNOWN,
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
  ;

  override val wire: String get() = name
}

enum class ProgressPhase(override val wire: String) : WireEnum {
  DOWNLOAD("download"),
  PROCESSING("processing"),
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
