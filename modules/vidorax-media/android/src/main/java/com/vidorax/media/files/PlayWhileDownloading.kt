package com.vidorax.media.files

import com.vidorax.media.model.DownloadState
import com.vidorax.media.model.SourceKind
import java.io.File
import java.io.IOException
import java.io.RandomAccessFile
import java.security.SecureRandom
import java.util.concurrent.ConcurrentHashMap

/**
 * H20 Play While Downloading (#411): which unfinished downloads can be watched from their `.part`, and how many bytes
 * of it can be played.
 *
 * Only a progressive MP4 whose index (`moov`) comes before its media (a "fast start" file), not fragmented and not
 * encrypted, once the whole index and [MIN_MEDIA_BYTES] after it are on disk, and only while it is still being
 * downloaded (queued, running, waiting or paused) — never HLS or DASH, never separate audio and video that will be
 * merged, never while it is being processed. The player reads it through [GrowingFileProvider], which serves the
 * contiguous bytes from the start and waits at their end for more.
 */
internal object PlayWhileDownloading {
  /** After the index: enough media for a few seconds of a typical stream before playback starts. */
  const val MIN_MEDIA_BYTES = 2L * 1024 * 1024

  /** The proxy file descriptor the provider serves needs API 26. */
  const val MIN_SDK = 26

  /** Why a download cannot be played yet; `wire` is `PlayableSource.reason` in VidoraMedia.types.ts. */
  enum class Refusal(val wire: String) {
    NOT_FOUND("not_found"),
    STREAM("stream"),
    PROCESSING("processing"),
    NOT_DOWNLOADING("not_downloading"),
    UNKNOWN_SIZE("unknown_size"),
    NOT_MP4("not_mp4"),
    INDEX_AT_END("index_at_end"),
    FRAGMENTED("fragmented"),
    ENCRYPTED("encrypted"),
    NOT_ENOUGH_BYTES("not_enough_bytes"),
    UNSUPPORTED_DEVICE("unsupported_device"),
  }

  private val PLAYABLE_STATES = setOf(
    DownloadState.QUEUED,
    DownloadState.PROBING,
    DownloadState.DOWNLOADING,
    DownloadState.WAITING_NETWORK,
    DownloadState.WAITING_RETRY,
    DownloadState.PAUSED,
  )

  /** What the decision looks at; everything is read by the caller. */
  data class Facts(
    val state: DownloadState,
    val kind: SourceKind,
    /** A segment checkpoint or a separate audio `.part` in the work folder: not one progressive file. */
    val segmentedOrSplit: Boolean,
    val totalBytes: Long?,
    /** Contiguous bytes from 0 ([PlayablePrefix]); null when it cannot be told. */
    val prefixBytes: Long?,
    val layout: Mp4Layout.Verdict,
    val sdk: Int,
  )

  /** Null when [facts] describe a download that can be played now. */
  fun refusal(facts: Facts): Refusal? = when {
    facts.state == DownloadState.PROCESSING -> Refusal.PROCESSING
    facts.state !in PLAYABLE_STATES -> Refusal.NOT_DOWNLOADING
    facts.kind != SourceKind.PROGRESSIVE || facts.segmentedOrSplit -> Refusal.STREAM
    facts.sdk < MIN_SDK -> Refusal.UNSUPPORTED_DEVICE
    facts.totalBytes == null || facts.totalBytes <= 0 -> Refusal.UNKNOWN_SIZE
    else -> when (val layout = facts.layout) {
      Mp4Layout.Verdict.NotMp4 -> Refusal.NOT_MP4
      Mp4Layout.Verdict.IndexAtEnd -> Refusal.INDEX_AT_END
      Mp4Layout.Verdict.Fragmented -> Refusal.FRAGMENTED
      Mp4Layout.Verdict.Encrypted -> Refusal.ENCRYPTED
      Mp4Layout.Verdict.Incomplete -> Refusal.NOT_ENOUGH_BYTES
      is Mp4Layout.Verdict.FastStart -> {
        val prefix = facts.prefixBytes ?: 0L
        if (prefix >= facts.totalBytes || prefix >= layout.moovEnd + MIN_MEDIA_BYTES) null else Refusal.NOT_ENOUGH_BYTES
      }
    }
  }
}

/**
 * The bytes of a `.part` that are downloaded contiguously from byte 0 — what can be played. A single-connection
 * transfer appends in order, so that is the file's length.
 *
 * **The one place F1 (several connections per file) has to change:** a multi-connection `.part` is pre-sized to the
 * whole file and filled in ranges, with a parts checkpoint beside it (`download.part.parts`), so its length says
 * nothing about what is there. Until F1 answers here (`PartsCheckpoint.read(partFile)?.contiguousPrefix`), such a
 * download is not offered: [of] is null.
 */
internal object PlayablePrefix {
  private const val PARTS_SUFFIX = ".parts"

  fun of(partFile: File): Long? {
    if (File(partFile.path + PARTS_SUFFIX).exists()) return null
    return if (partFile.isFile) partFile.length() else 0L
  }
}

/**
 * The top-level boxes at the start of an ISO-BMFF file: is it a progressive MP4 whose `moov` (the index of every
 * sample) comes before its media, and where does that index end? Only reads what [read] gives it, up to [available].
 */
internal object Mp4Layout {
  sealed interface Verdict {
    /** `ftyp`, then the whole `moov` (ending at [moovEnd]), before any `mdat`. */
    data class FastStart(val moovEnd: Long) : Verdict

    data object NotMp4 : Verdict

    /** `mdat` comes first: nothing can be decoded until the very end has arrived. */
    data object IndexAtEnd : Verdict

    /** Fragmented MP4 (`moov` with `mvex`, or `moof` first): its index is spread over the file. */
    data object Fragmented : Verdict

    /** Protected tracks (`encv`/`enca`/`sinf`/`pssh`). */
    data object Encrypted : Verdict

    /** The index is not all on disk yet. */
    data object Incomplete : Verdict
  }

  /** Larger indexes are not played while downloading (they would hold too much in memory to check). */
  const val MAX_MOOV_BYTES = 32 * 1024 * 1024
  private const val MAX_TOP_LEVEL_BOXES = 64
  private const val MAX_DEPTH = 8
  /** Boxes of the index whose children are boxes; `stsd` lists the sample entries after 8 more bytes. */
  private val CONTAINERS = setOf("moov", "trak", "mdia", "minf", "stbl")
  private val ENCRYPTED = setOf("encv", "enca", "pssh")

  fun inspect(available: Long, read: (offset: Long, length: Int) -> ByteArray?): Verdict {
    var offset = 0L
    var first = true
    repeat(MAX_TOP_LEVEL_BOXES) {
      if (offset + 8 > available) return Verdict.Incomplete
      val header = read(offset, minOf(16L, available - offset).toInt()) ?: return Verdict.Incomplete
      if (header.size < 8) return Verdict.Incomplete
      var size = u32(header, 0)
      val type = String(header, 4, 4, Charsets.ISO_8859_1)
      var headerSize = 8
      if (size == 1L) {
        if (header.size < 16) return Verdict.Incomplete
        size = u64(header, 8)
        headerSize = 16
      } else if (size == 0L) {
        return if (type == "moov") Verdict.Incomplete else if (first) Verdict.NotMp4 else Verdict.IndexAtEnd
      }
      if (size < headerSize) return Verdict.NotMp4
      if (first && type != "ftyp") return Verdict.NotMp4
      first = false
      when (type) {
        "mdat" -> return Verdict.IndexAtEnd
        "moof" -> return Verdict.Fragmented
        "moov" -> {
          if (size > MAX_MOOV_BYTES) return Verdict.Incomplete
          if (offset + size > available) return Verdict.Incomplete
          val moov = read(offset, size.toInt()) ?: return Verdict.Incomplete
          val found = HashSet<String>()
          scan(moov, 0, moov.size, found, 0)
          if ("mvex" in found) return Verdict.Fragmented
          if (found.any { it in ENCRYPTED }) return Verdict.Encrypted
          return Verdict.FastStart(offset + size)
        }
      }
      offset += size
    }
    return Verdict.NotMp4
  }

  /** Collects the box types of the index: the containers' children, and `stsd`'s sample entries (`encv`, `avc1`…). */
  private fun scan(data: ByteArray, from: Int, to: Int, found: MutableSet<String>, depth: Int) {
    if (depth > MAX_DEPTH) return
    var at = from
    while (at + 8 <= to) {
      var size = u32(data, at)
      var header = 8
      if (size == 1L) {
        if (at + 16 > to) return
        size = u64(data, at + 8)
        header = 16
      } else if (size == 0L) {
        size = (to - at).toLong()
      }
      if (size < header || at + size > to) return
      val type = String(data, at + 4, 4, Charsets.ISO_8859_1)
      found += type
      val end = at + size.toInt()
      when {
        type in CONTAINERS -> scan(data, at + header, end, found, depth + 1)
        type == "stsd" -> scan(data, at + header + 8, end, found, depth + 1)
      }
      at = end
    }
  }

  private fun u32(b: ByteArray, at: Int): Long =
    ((b[at].toLong() and 0xff) shl 24) or ((b[at + 1].toLong() and 0xff) shl 16) or
      ((b[at + 2].toLong() and 0xff) shl 8) or (b[at + 3].toLong() and 0xff)

  private fun u64(b: ByteArray, at: Int): Long = (u32(b, at) shl 32) or u32(b, at + 4)

  /** [Mp4Layout.inspect] over a file's first bytes. */
  fun inspect(file: File, available: Long): Verdict = runCatching {
    RandomAccessFile(file, "r").use { raf ->
      inspect(available) { offset, length ->
        if (length <= 0) return@inspect ByteArray(0)
        ByteArray(length).also {
          raf.seek(offset)
          raf.readFully(it)
        }
      }
    }
  }.getOrDefault(Verdict.Incomplete)
}

/**
 * Reads a growing `.part` for the player: bytes up to [prefix] at once; a read past them waits (in [pollMs] steps,
 * at most [maxWaitMs]) for the download to bring more. A read fails ([IOException], which the player retries or shows)
 * when nothing more arrives in time — the download was paused, failed or the network is gone — and when what was
 * already served can no longer be trusted: the `.part` got shorter (the download restarted from zero) or its file is
 * gone and was not completed in full.
 *
 * What may be served is [PlayablePrefix] of [partFile] — when that cannot be told (a multi-connection `.part`) reads
 * fail rather than serve bytes that may not be there. A download that completed moved its `.part` into the library:
 * the open [file] still reads it, and when it is complete ([total] bytes) all of it is served.
 */
internal class GrowingFileReader(
  private val file: RandomAccessFile,
  private val total: Long,
  private val partFile: File,
  private val sleep: (Long) -> Unit = { Thread.sleep(it) },
  private val clock: () -> Long = System::currentTimeMillis,
  private val pollMs: Long = 250,
  private val maxWaitMs: Long = 15_000,
) {
  private var highestServed = 0L

  fun size(): Long = total

  /** Fills `out[0 until n)` with the bytes at [offset]; 0 at the end of the file. */
  @Synchronized
  fun read(offset: Long, size: Int, out: ByteArray): Int {
    if (offset >= total || size <= 0) return 0
    val end = minOf(total, offset + size)
    val started = clock()
    while (true) {
      val available = available()
      if (available < highestServed) throw IOException("The download started again from the beginning")
      if (available > offset) {
        val count = (minOf(end, available) - offset).toInt()
        file.seek(offset)
        file.readFully(out, 0, count)
        highestServed = maxOf(highestServed, offset + count)
        return count
      }
      if (clock() - started >= maxWaitMs) throw IOException("No more bytes arrived in time")
      sleep(pollMs)
    }
  }

  private fun available(): Long {
    if (partFile.exists()) {
      val prefix = PlayablePrefix.of(partFile) ?: throw IOException("The downloaded bytes cannot be told apart")
      return prefix.coerceAtMost(total)
    }
    // The `.part` is gone: completed in full (moved to the library, still readable here) or cancelled.
    val length = runCatching { file.length() }.getOrDefault(0L)
    if (length == total) return total
    throw IOException("The download is gone")
  }
}

/** Downloads opened for playback while downloading, by an unguessable token (the provider URI never holds an id). */
internal object PlaybackSessions {
  data class Session(val downloadId: String, val partFile: File, val totalBytes: Long)

  private const val MAX_SESSIONS = 4
  private val sessions = ConcurrentHashMap<String, Session>()
  private val order = ArrayDeque<String>()
  private val random = SecureRandom()

  @Synchronized
  fun open(session: Session): String {
    val token = ByteArray(16).also(random::nextBytes).joinToString("") { "%02x".format(it) }
    sessions[token] = session
    order.addLast(token)
    while (order.size > MAX_SESSIONS) order.removeFirstOrNull()?.let { sessions.remove(it) }
    return token
  }

  fun get(token: String): Session? = sessions[token]

  @Synchronized
  fun close(token: String) {
    sessions.remove(token)
    order.remove(token)
  }

  @Synchronized
  internal fun clearForTests() {
    sessions.clear()
    order.clear()
  }
}

/**
 * `checkPlayable` / `getPlayableSource` (VidoraMediaModule): whether an unfinished download can be played now — with
 * [open], also the provider URI of a new playback session — or why not. [record] is the engine's view of the download;
 * [workDir] its work folder.
 */
internal object PlayableSources {
  fun answer(
    context: android.content.Context,
    record: com.vidorax.media.model.DownloadRecord?,
    workDir: File,
    open: Boolean,
    sdk: Int = android.os.Build.VERSION.SDK_INT,
  ): Map<String, Any?> {
    if (record == null) return refused(PlayWhileDownloading.Refusal.NOT_FOUND)
    val part = File(workDir, com.vidorax.media.engine.DownloadEngine.PART_NAME)
    val segmentedOrSplit = File(workDir, com.vidorax.media.engine.DownloadEngine.HLS_CHECKPOINT_NAME).exists() ||
      File(workDir, com.vidorax.media.engine.DownloadEngine.AUDIO_PART_NAME).exists()
    val prefix = PlayablePrefix.of(part)
    val layout = if (prefix != null && prefix > 0) Mp4Layout.inspect(part, prefix) else Mp4Layout.Verdict.Incomplete
    val facts = PlayWhileDownloading.Facts(
      state = record.state,
      kind = record.kind,
      segmentedOrSplit = segmentedOrSplit,
      totalBytes = record.totalBytes,
      prefixBytes = prefix,
      layout = layout,
      sdk = sdk,
    )
    PlayWhileDownloading.refusal(facts)?.let { return refused(it) }
    val total = record.totalBytes ?: return refused(PlayWhileDownloading.Refusal.UNKNOWN_SIZE)
    val playable = mapOf(
      "playable" to true,
      "playableBytes" to (prefix ?: 0L).toDouble(),
      "totalBytes" to total.toDouble(),
      "mimeType" to "video/mp4",
    )
    if (!open) return playable
    val token = PlaybackSessions.open(PlaybackSessions.Session(record.id, part, total))
    return playable + ("uri" to GrowingFileProvider.uriFor(context, token).toString())
  }

  /** Ends a playback session opened by [answer] (the player closed). */
  fun release(uri: String) {
    val token = uri.substringAfterLast('/', "").takeIf { it.matches(TOKEN) } ?: return
    PlaybackSessions.close(token)
  }

  private val TOKEN = Regex("^[0-9a-f]{32}$")

  private fun refused(reason: PlayWhileDownloading.Refusal): Map<String, Any?> =
    mapOf("playable" to false, "reason" to reason.wire)
}
