package com.vidorax.media.bridge

import com.vidorax.media.InvalidRequestException
import com.vidorax.media.library.Titles
import com.vidorax.media.model.DownloadSettings
import com.vidorax.media.model.EnqueueRequest
import com.vidorax.media.model.LegacyMetadata
import com.vidorax.media.model.LibraryQuery
import com.vidorax.media.model.LibrarySort
import com.vidorax.media.model.ProbeRequest
import com.vidorax.media.model.RequestContext
import com.vidorax.media.model.SiteId
import com.vidorax.media.model.SourceKind
import com.vidorax.media.model.VariantChoice
import com.vidorax.media.model.WireEnum
import com.vidorax.media.model.wireValueOf
import expo.modules.kotlin.records.Field
import expo.modules.kotlin.records.Record
import okhttp3.HttpUrl.Companion.toHttpUrlOrNull

// Function arguments of src/VidoraMedia.types.ts as Expo converts them from JavaScript. Every field has a default so
// optional keys may be missing; toModel() validates and rejects malformed input with ERR_INVALID_REQUEST. Unions stay
// strings here so an unknown value gets that code instead of a conversion error.

data class RequestContextRecord(
  @Field val userAgent: String? = null,
  @Field val referer: String? = null,
  @Field val origin: String? = null,
  @Field val headers: Map<String, String>? = null,
  @Field val useCookies: Boolean = false,
) : Record {
  fun toModel() = RequestContext(
    userAgent = userAgent.nonBlank(),
    referer = referer.nonBlank(),
    origin = origin.nonBlank(),
    // Cookies only ever come from CookieManager.
    headers = headers.orEmpty().filterKeys { !it.equals("Cookie", ignoreCase = true) },
    useCookies = useCookies,
  )
}

data class ProbeRequestRecord(
  @Field val url: String = "",
  @Field val kind: String? = null,
  @Field val manifestText: String? = null,
  @Field val request: RequestContextRecord = RequestContextRecord(),
  @Field val variant: VariantChoiceRecord? = null,
) : Record {
  fun toModel(): ProbeRequest {
    val sourceKind = kind?.let { parseWire<SourceKind>(it, "kind") }
    if (manifestText != null && sourceKind != null && sourceKind != SourceKind.DASH) {
      invalid("manifestText is only valid for DASH")
    }
    return ProbeRequest(httpUrl(url, "url"), sourceKind, manifestText, request.toModel(), variant?.toModel())
  }
}

data class VariantChoiceRecord(
  @Field val videoId: String? = null,
  @Field val audioId: String? = null,
  @Field val maxHeight: Int? = null,
) : Record {
  fun toModel(): VariantChoice {
    if (maxHeight != null && maxHeight <= 0) invalid("variant.maxHeight must be positive")
    return VariantChoice(videoId.nonBlank(), audioId.nonBlank(), maxHeight)
  }
}

data class EnqueueRequestRecord(
  @Field val url: String = "",
  @Field val kind: String = "",
  @Field val manifestText: String? = null,
  @Field val audioUrl: String? = null,
  @Field val variant: VariantChoiceRecord? = null,
  @Field val request: RequestContextRecord = RequestContextRecord(),
  @Field val title: String = "",
  @Field val site: String = "",
  @Field val pageUrl: String? = null,
  @Field val thumbnailUrl: String? = null,
  @Field val durationMs: Double? = null,
  @Field val estimatedBytes: Double? = null,
  @Field val qualityLabel: String? = null,
  @Field val saveToGallery: Boolean? = null,
) : Record {
  fun toModel(): EnqueueRequest {
    val sourceKind = parseWire<SourceKind>(kind, "kind")
    if (manifestText != null && sourceKind != SourceKind.DASH) invalid("manifestText is only valid for DASH")
    if (audioUrl != null && sourceKind != SourceKind.PROGRESSIVE) invalid("audioUrl is only valid for progressive")
    return EnqueueRequest(
      url = httpUrl(url, "url"),
      kind = sourceKind,
      manifestText = manifestText,
      audioUrl = audioUrl?.let { httpUrl(it, "audioUrl") },
      variant = variant?.toModel(),
      request = request.toModel(),
      title = Titles.clamp(title),
      site = parseWire(site, "site"),
      pageUrl = pageUrl.nonBlank(),
      thumbnailUrl = thumbnailUrl.nonBlank(),
      durationMs = durationMs.positiveLong(),
      estimatedBytes = estimatedBytes.positiveLong(),
      qualityLabel = qualityLabel.nonBlank()?.trim(),
      saveToGallery = saveToGallery,
    )
  }
}

data class DownloadSettingsRecord(
  @Field val maxConcurrent: Int = DownloadSettings.DEFAULT.maxConcurrent,
  @Field val wifiOnly: Boolean = DownloadSettings.DEFAULT.wifiOnly,
  @Field val autoSaveToGallery: Boolean = DownloadSettings.DEFAULT.autoSaveToGallery,
  @Field val preferredMaxHeight: Int? = null,
) : Record {
  fun toModel(): DownloadSettings {
    if (maxConcurrent !in DownloadSettings.MIN_CONCURRENT..DownloadSettings.MAX_CONCURRENT) {
      invalid("maxConcurrent must be ${DownloadSettings.MIN_CONCURRENT}-${DownloadSettings.MAX_CONCURRENT}")
    }
    if (preferredMaxHeight != null && preferredMaxHeight <= 0) invalid("preferredMaxHeight must be positive")
    return DownloadSettings(maxConcurrent, wifiOnly, autoSaveToGallery, preferredMaxHeight)
  }
}

data class LibraryQueryRecord(
  @Field val search: String? = null,
  @Field val site: String? = null,
  @Field val favoritesOnly: Boolean? = null,
  @Field val sort: String? = null,
  @Field val limit: Int? = null,
  @Field val offset: Int? = null,
) : Record {
  /** Paging is clamped rather than rejected: limit 1..200 (default 50), offset from 0. */
  fun toModel() = LibraryQuery(
    search = search?.trim().nonBlank(),
    site = site?.let { parseWire<SiteId>(it, "site") },
    favoritesOnly = favoritesOnly == true,
    sort = sort?.let { parseWire<LibrarySort>(it, "sort") } ?: LibrarySort.NEWEST,
    limit = limit?.coerceIn(1, LibraryQuery.MAX_LIMIT) ?: LibraryQuery.DEFAULT_LIMIT,
    offset = offset?.coerceAtLeast(0) ?: 0,
  )
}

data class LegacyMetadataRecord(
  @Field val id: String = "",
  @Field val title: String? = null,
  @Field val site: String? = null,
  @Field val pageUrl: String? = null,
  @Field val favorite: Boolean? = null,
) : Record {
  /** Missing, null and blank fields leave the stored value unchanged. */
  fun toModel(): LegacyMetadata {
    if (id.isBlank()) invalid("Legacy metadata needs an id")
    return LegacyMetadata(
      id = id,
      title = title.nonBlank(),
      site = site?.let { parseWire<SiteId>(it, "site") },
      pageUrl = pageUrl.nonBlank(),
      favorite = favorite,
    )
  }
}

private fun invalid(message: String): Nothing = throw InvalidRequestException(message)

private inline fun <reified T> parseWire(value: String, field: String): T where T : Enum<T>, T : WireEnum =
  wireValueOf<T>(value) ?: invalid("Unknown $field \"$value\"")

private fun httpUrl(value: String, field: String): String {
  val url = value.trim()
  if (url.toHttpUrlOrNull() == null) invalid("$field must be an http or https URL")
  return url
}

private fun String?.nonBlank(): String? = this?.takeIf { it.isNotBlank() }

private fun Double?.positiveLong(): Long? = this?.takeIf { it.isFinite() && it > 0 }?.toLong()
