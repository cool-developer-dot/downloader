package com.vidorax.media.incoming

import android.content.ContentResolver
import android.content.Intent
import android.database.Cursor
import android.net.Uri
import android.provider.OpenableColumns
import android.util.Log
import com.vidorax.media.library.ContentHash
import com.vidorax.media.library.MediaTypes
import java.io.File

/**
 * A video or audio file another app asked VidoraX to open (contract: `IncomingMedia` in src/VidoraMedia.types.ts).
 * [uri] stays native; JavaScript only ever sees [token], except through `getIncomingMediaSource` for the player.
 */
data class IncomingMedia(
  val token: String,
  val uri: Uri,
  val displayName: String?,
  val mimeType: String?,
  val sizeBytes: Long?,
  val kind: Kind,
) {
  enum class Kind(val wire: String) { VIDEO("video"), AUDIO("audio") }
}

/** What an intent asks to open, before the resolver is asked for the name and size. */
internal data class IncomingCandidate(val uri: Uri, val mimeType: String?, val kind: IncomingMedia.Kind)

internal object IncomingMediaIntents {
  private const val TOKEN_HEX_CHARS = 32

  /**
   * A `VIEW` of a `content:` or `file:` URI whose type is a known audio or video type: the intent's own type, else
   * the one the resolver reports ([resolvedType]), else the extension of [displayName] or of the URI's last segment.
   * Web links (the browser's), intents without data and anything that is not audio/video give null.
   */
  fun parse(action: String?, data: Uri?, type: String?, resolvedType: String?, displayName: String?): IncomingCandidate? {
    if (action != Intent.ACTION_VIEW || data == null) return null
    val scheme = data.scheme?.lowercase()
    if (scheme != ContentResolver.SCHEME_CONTENT && scheme != ContentResolver.SCHEME_FILE) return null
    for (mime in listOf(type, resolvedType)) {
      val clean = mime?.substringBefore(';')?.trim()?.lowercase()?.takeIf { it.isNotEmpty() } ?: continue
      kindOfMime(clean)?.let { return IncomingCandidate(data, clean, it) }
    }
    for (name in listOf(displayName, data.lastPathSegment)) {
      val byName = name?.let(MediaTypes::forFileName) ?: continue
      val kind = if (byName.isAudioOnly) IncomingMedia.Kind.AUDIO else IncomingMedia.Kind.VIDEO
      return IncomingCandidate(data, byName.mimeType, kind)
    }
    return null
  }

  /** Stable for a URI, so the same file opened twice keeps its resume position; reveals nothing of the URI. */
  fun tokenFor(uri: Uri): String = ContentHash.sha256("incoming:$uri").take(TOKEN_HEX_CHARS)

  fun isToken(value: String): Boolean = value.length == TOKEN_HEX_CHARS && value.all { it in '0'..'9' || it in 'a'..'f' }

  private fun kindOfMime(mime: String): IncomingMedia.Kind? = when {
    mime.startsWith("video/") -> IncomingMedia.Kind.VIDEO
    mime.startsWith("audio/") -> IncomingMedia.Kind.AUDIO
    else -> MediaTypes.forMimeType(mime)?.let { if (it.isAudioOnly) IncomingMedia.Kind.AUDIO else IncomingMedia.Kind.VIDEO }
  }
}

/** Incoming files of this process by token; the oldest are forgotten past [capacity]. Thread-safe. */
class IncomingMediaRegistry(private val capacity: Int = DEFAULT_CAPACITY) {
  private val byToken = object : LinkedHashMap<String, IncomingMedia>(capacity, 0.75f, true) {
    override fun removeEldestEntry(eldest: MutableMap.MutableEntry<String, IncomingMedia>?): Boolean = size > capacity
  }

  @Synchronized
  fun put(media: IncomingMedia) {
    byToken[media.token] = media
  }

  @Synchronized
  fun get(token: String): IncomingMedia? = byToken[token]

  companion object {
    const val DEFAULT_CAPACITY = 32
  }
}

/** Reads the incoming file of an intent: at most once per intent, so a JavaScript reload does not reopen it. */
class IncomingMediaReader(private val resolver: ContentResolver) {
  fun take(intent: Intent?): IncomingMedia? {
    if (intent == null || intent.getBooleanExtra(CONSUMED_EXTRA, false)) return null
    val data = intent.data ?: return null
    if (intent.action != Intent.ACTION_VIEW) return null
    val details = details(data)
    val resolvedType = if (intent.type == null) runCatching { resolver.getType(data) }.getOrNull() else null
    val candidate = IncomingMediaIntents.parse(intent.action, data, intent.type, resolvedType, details.name) ?: return null
    intent.putExtra(CONSUMED_EXTRA, true)
    if (intent.flags and Intent.FLAG_GRANT_PERSISTABLE_URI_PERMISSION != 0) {
      try {
        resolver.takePersistableUriPermission(data, Intent.FLAG_GRANT_READ_URI_PERMISSION)
      } catch (e: SecurityException) {
        Log.w(TAG, "Persistable read access was offered but not granted")
      }
    }
    return IncomingMedia(
      token = IncomingMediaIntents.tokenFor(data),
      uri = data,
      displayName = details.name,
      mimeType = candidate.mimeType,
      sizeBytes = details.size,
      kind = candidate.kind,
    )
  }

  private data class Details(val name: String?, val size: Long?)

  private fun details(uri: Uri): Details {
    if (uri.scheme.equals(ContentResolver.SCHEME_FILE, ignoreCase = true)) {
      val file = uri.path?.let(::File) ?: return Details(null, null)
      return Details(file.name.takeIf { it.isNotEmpty() }, runCatching { file.length() }.getOrNull()?.takeIf { it > 0 })
    }
    return try {
      resolver.query(uri, arrayOf(OpenableColumns.DISPLAY_NAME, OpenableColumns.SIZE), null, null, null)?.use { cursor ->
        if (!cursor.moveToFirst()) return Details(null, null)
        Details(cursor.stringAt(OpenableColumns.DISPLAY_NAME), cursor.longAt(OpenableColumns.SIZE))
      } ?: Details(null, null)
    } catch (e: RuntimeException) {
      // Some providers refuse queries (or throw SecurityException); the file may still open.
      Details(null, null)
    }
  }

  private fun Cursor.stringAt(column: String): String? {
    val index = getColumnIndex(column)
    return if (index < 0 || isNull(index)) null else getString(index)?.takeIf { it.isNotBlank() }
  }

  private fun Cursor.longAt(column: String): Long? {
    val index = getColumnIndex(column)
    return if (index < 0 || isNull(index)) null else getLong(index).takeIf { it > 0 }
  }

  private companion object {
    const val TAG = "VidoraMedia"
    const val CONSUMED_EXTRA = "com.vidorax.media.extra.INCOMING_MEDIA_CONSUMED"
  }
}
