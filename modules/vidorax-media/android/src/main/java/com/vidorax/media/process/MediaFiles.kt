package com.vidorax.media.process

import android.media.MediaFormat
import android.net.Uri
import androidx.annotation.OptIn
import androidx.media3.common.Format
import androidx.media3.common.MimeTypes
import androidx.media3.common.util.MediaFormatUtil
import androidx.media3.common.util.TimestampAdjuster
import androidx.media3.common.util.UnstableApi
import androidx.media3.datasource.FileDataSource
import androidx.media3.extractor.DefaultExtractorsFactory
import androidx.media3.extractor.Extractor
import androidx.media3.extractor.ExtractorsFactory
import androidx.media3.extractor.ts.AdtsExtractor
import androidx.media3.extractor.ts.DefaultTsPayloadReaderFactory
import androidx.media3.extractor.ts.TsExtractor
import androidx.media3.inspector.MediaExtractorCompat
import java.io.File
import java.io.RandomAccessFile

/**
 * What a track file is, as the engine downloaded it. [TS] and [PACKED_AUDIO] keep their stream timestamps (see
 * [ProcessingExtractors]); everything else is read by Media3's default extractors — the ones the player uses.
 */
internal enum class TrackContainer {
  MP4,
  WEBM,
  MKV,
  TS,
  AVI,
  FLV,
  THREE_GP,
  /** ADTS AAC (an HLS packed-audio rendition with its ID3 timestamps removed). */
  PACKED_AUDIO,
  /** Media3 sniffs it. */
  UNKNOWN,
}

internal enum class TrackKind { VIDEO, AUDIO, OTHER }

internal data class MediaTrack(
  /** Index in the extractor's track list. */
  val index: Int,
  val kind: TrackKind,
  val mimeType: String,
  /** Media3's view of the track, as the muxers need it (codec config, size, rotation, sample rate…). */
  val format: Format,
  val durationUs: Long?,
)

internal data class MediaFileInfo(
  val tracks: List<MediaTrack>,
  /** Longest track, when the container states it. */
  val durationUs: Long?,
  /** ISO-BMFF with movie fragments: plays, but seeks and reports its length poorly as one file. */
  val fragmented: Boolean,
  /** DRM/Common Encryption data in the container: never processed, never kept. */
  val encrypted: Boolean,
) {
  val video: MediaTrack? get() = tracks.firstOrNull { it.kind == TrackKind.VIDEO }
  val audio: MediaTrack? get() = tracks.firstOrNull { it.kind == TrackKind.AUDIO }
}

/**
 * Extractor choice per downloaded container. MPEG-TS is read with its original presentation timestamps
 * ([TimestampAdjuster.MODE_NO_OFFSET]) instead of each file being rebased to zero, so a video and an audio rendition
 * cut from one encode keep the offset they had against each other — rebasing both would shift the sound by the
 * streams' start difference. Packed audio is ADTS whose timestamp the engine read from the segment's ID3 tag.
 */
@OptIn(UnstableApi::class)
internal object ProcessingExtractors {
  fun forContainer(container: TrackContainer): ExtractorsFactory = when (container) {
    TrackContainer.TS -> ExtractorsFactory {
      arrayOf<Extractor>(
        TsExtractor(
          TsExtractor.MODE_SINGLE_PMT,
          TimestampAdjuster(TimestampAdjuster.MODE_NO_OFFSET),
          DefaultTsPayloadReaderFactory(DefaultTsPayloadReaderFactory.FLAG_ALLOW_NON_IDR_KEYFRAMES),
        ),
      )
    }
    TrackContainer.PACKED_AUDIO -> ExtractorsFactory { arrayOf<Extractor>(AdtsExtractor()) }
    else -> DefaultExtractorsFactory()
  }
}

/** Reads track lists of local files with Media3's extractors. Blocking; never throws for unreadable media. */
@OptIn(UnstableApi::class)
internal object MediaFiles {
  /** An extractor over [file]; the caller releases it. Throws when no extractor recognises the bytes. */
  fun open(file: File, container: TrackContainer): MediaExtractorCompat {
    val extractor = MediaExtractorCompat(ProcessingExtractors.forContainer(container), FileDataSource.Factory())
    try {
      extractor.setDataSource(Uri.fromFile(file), 0)
    } catch (e: Exception) {
      extractor.release()
      throw e
    }
    return extractor
  }

  /** The file's tracks, or null when Media3 cannot parse the container at all (e.g. ASF/WMV). */
  fun read(file: File, container: TrackContainer): MediaFileInfo? {
    val extractor = try {
      open(file, container)
    } catch (e: Exception) {
      return null
    }
    return try {
      val tracks = (0 until extractor.trackCount).mapNotNull { index -> track(index, extractor.getTrackFormat(index)) }
      MediaFileInfo(
        tracks = tracks,
        durationUs = tracks.mapNotNull { it.durationUs }.maxOrNull(),
        fragmented = container == TrackContainer.MP4 && isFragmented(file),
        encrypted = extractor.drmInitData != null || tracks.any { it.format.drmInitData != null },
      )
    } catch (e: Exception) {
      null
    } finally {
      extractor.release()
    }
  }

  fun track(index: Int, mediaFormat: MediaFormat): MediaTrack? {
    val mime = mediaFormat.getString(MediaFormat.KEY_MIME) ?: return null
    val format = MediaFormatUtil.createFormatFromMediaFormat(mediaFormat)
    val kind = when {
      MimeTypes.isVideo(mime) -> TrackKind.VIDEO
      MimeTypes.isAudio(mime) -> TrackKind.AUDIO
      else -> TrackKind.OTHER
    }
    val duration = if (mediaFormat.containsKey(MediaFormat.KEY_DURATION)) mediaFormat.getLong(MediaFormat.KEY_DURATION) else null
    return MediaTrack(index, kind, mime, format, duration?.takeIf { it > 0 })
  }

  /** A top-level `moof` within the first boxes: a fragmented (DASH/CMAF/HLS-fMP4) file. Seeks only. */
  fun isFragmented(file: File): Boolean = runCatching {
    RandomAccessFile(file, "r").use { raf ->
      val length = raf.length()
      val header = ByteArray(16)
      var offset = 0L
      var boxes = 0
      while (offset + 8 <= length && boxes < MAX_TOP_LEVEL_BOXES) {
        raf.seek(offset)
        raf.readFully(header, 0, 8)
        val type = String(header, 4, 4, Charsets.ISO_8859_1)
        if (type == "moof" || type == "mvex") return@use true
        var size = u32(header, 0)
        if (size == 1L) {
          if (offset + 16 > length) return@use false
          raf.readFully(header, 8, 8)
          size = u64(header, 8)
        } else if (size == 0L) {
          return@use false
        }
        if (type == "moov" && size in 9..MAX_MOOV_SCAN) {
          // `mvex` inside the moov announces fragments even before the first `moof`.
          val moov = ByteArray((size - 8).toInt())
          raf.readFully(moov)
          if (containsAscii(moov, "mvex")) return@use true
        }
        if (size < 8) return@use false
        offset += size
        boxes++
      }
      false
    }
  }.getOrDefault(false)

  private fun containsAscii(data: ByteArray, needle: String): Boolean {
    val target = needle.toByteArray(Charsets.ISO_8859_1)
    outer@ for (i in 0..data.size - target.size) {
      for (j in target.indices) if (data[i + j] != target[j]) continue@outer
      return true
    }
    return false
  }

  private fun u32(data: ByteArray, at: Int): Long =
    ((data[at].toLong() and 0xFF) shl 24) or ((data[at + 1].toLong() and 0xFF) shl 16) or
      ((data[at + 2].toLong() and 0xFF) shl 8) or (data[at + 3].toLong() and 0xFF)

  private fun u64(data: ByteArray, at: Int): Long {
    var v = 0L
    for (i in 0 until 8) v = (v shl 8) or (data[at + i].toLong() and 0xFF)
    return v
  }

  private const val MAX_TOP_LEVEL_BOXES = 64
  private const val MAX_MOOV_SCAN = 8L * 1024 * 1024
}

/**
 * Start delays that a fragmented MP4's edit lists state but Media3's fragmented extractor leaves out. That extractor
 * applies an edit list only when it is one entry that covers the whole track. An encoder that starts a track late
 * writes an empty edit (a delay) and then the media edit — e.g. HLS fMP4 from ffmpeg: video
 * `[66 ms empty][from 1024]`, audio `[45 ms empty][from 0]`. Read without it, the sound starts 45 ms early against
 * the picture. The correction is what the edit list says minus what the extractor applied:
 * `delay − mediaTime`. Progressive MP4s need none (Media3 applies their edit lists fully).
 */
internal object FragmentEdits {
  /** Microseconds to add to the extractor's sample times, per track kind; empty when nothing is left out. */
  fun correctionsUs(file: File, container: TrackContainer): Map<TrackKind, Long> {
    if (container != TrackContainer.MP4) return emptyMap()
    return runCatching { read(file) }.getOrNull() ?: emptyMap()
  }

  private class Trak(var kind: TrackKind = TrackKind.OTHER) {
    var timescale = 0L
    var tkhdDuration = 0L
    var tkhdDurationUnknown = false
    var edits: List<Pair<Long, Long>>? = null
  }

  private fun read(file: File): Map<TrackKind, Long>? {
    val moov = moovOf(file) ?: return null
    var movieTimescale = 0L
    var fragmented = false
    var fragmentDuration: Long? = null
    val traks = ArrayList<Trak>()
    children(moov, 0, moov.size) { type, start, end ->
      when (type) {
        "mvhd" -> movieTimescale = u32(moov, start + if (moov[start].toInt() == 1) 20 else 12)
        "mvex" -> {
          fragmented = true
          children(moov, start, end) { t, ms, _ ->
            if (t == "mehd") fragmentDuration = if (moov[ms].toInt() == 1) u64(moov, ms + 4) else u32(moov, ms + 4)
          }
        }
        "trak" -> traks += trak(moov, start, end)
      }
    }
    if (!fragmented || movieTimescale <= 0) return null
    val corrections = HashMap<TrackKind, Long>()
    for (trak in traks) {
      if (trak.kind == TrackKind.OTHER || trak.kind in corrections || trak.timescale <= 0) continue
      val edits = trak.edits ?: continue
      val correction = correctionUs(trak, edits, movieTimescale, fragmentDuration)
      if (correction != 0L) corrections[trak.kind] = correction
    }
    return corrections
  }

  private fun correctionUs(trak: Trak, edits: List<Pair<Long, Long>>, movieTimescale: Long, fragmentDuration: Long?): Long {
    val delay = edits.takeWhile { it.second == -1L }.sumOf { it.first }
    val mediaTime = edits.firstOrNull { it.second >= 0 }?.second ?: return 0
    val delayUs = scale(delay, movieTimescale)
    val mediaTimeUs = scale(mediaTime, trak.timescale)
    // What FragmentedMp4Extractor itself applies: a lone edit spanning the track (the `mehd` length, else `tkhd`'s).
    if (edits.size == 1) {
      val durationUs = when {
        fragmentDuration != null -> scale(fragmentDuration, movieTimescale)
        trak.tkhdDurationUnknown -> Long.MIN_VALUE
        else -> scale(trak.tkhdDuration, movieTimescale)
      }
      val spansTrack = edits[0].first == 0L || scale(edits[0].first, movieTimescale) + mediaTimeUs >= durationUs
      if (spansTrack) return 0
    }
    return delayUs - mediaTimeUs
  }

  private fun trak(data: ByteArray, start: Int, end: Int): Trak {
    val trak = Trak()
    children(data, start, end) { type, s, e ->
      when (type) {
        "tkhd" -> {
          val v1 = data[s].toInt() == 1
          val at = s + if (v1) 28 else 20
          val width = if (v1) 8 else 4
          trak.tkhdDurationUnknown = (0 until width).all { data[at + it] == 0xFF.toByte() }
          trak.tkhdDuration = if (v1) u64(data, at) else u32(data, at)
        }
        "edts" -> children(data, s, e) { t, es, _ -> if (t == "elst") trak.edits = elst(data, es) }
        "mdia" -> children(data, s, e) { t, ms, _ ->
          when (t) {
            "mdhd" -> trak.timescale = u32(data, ms + if (data[ms].toInt() == 1) 20 else 12)
            "hdlr" -> trak.kind = when (String(data, ms + 8, 4, Charsets.ISO_8859_1)) {
              "vide" -> TrackKind.VIDEO
              "soun" -> TrackKind.AUDIO
              else -> TrackKind.OTHER
            }
          }
        }
      }
    }
    return trak
  }

  /** (segment duration in the movie timescale, media time in the track timescale or −1 for an empty edit). */
  private fun elst(data: ByteArray, start: Int): List<Pair<Long, Long>> {
    val v1 = data[start].toInt() == 1
    val count = u32(data, start + 4).coerceAtMost(MAX_EDITS.toLong()).toInt()
    var at = start + 8
    return List(count) {
      val entry = if (v1) u64(data, at) to u64(data, at + 8) else u32(data, at) to u32(data, at + 4).toInt().toLong()
      at += if (v1) 20 else 12
      entry
    }
  }

  private fun moovOf(file: File): ByteArray? = RandomAccessFile(file, "r").use { raf ->
    val length = raf.length()
    val header = ByteArray(16)
    var offset = 0L
    repeat(MAX_TOP_LEVEL_BOXES) {
      if (offset + 8 > length) return@use null
      raf.seek(offset)
      raf.readFully(header, 0, 8)
      var size = u32(header, 0)
      var headerSize = 8
      if (size == 1L) {
        raf.readFully(header, 8, 8)
        size = u64(header, 8)
        headerSize = 16
      }
      val type = String(header, 4, 4, Charsets.ISO_8859_1)
      if (type == "moov") {
        if (size - headerSize !in 1..MAX_MOOV_BYTES) return@use null
        return@use ByteArray((size - headerSize).toInt()).also { raf.readFully(it) }
      }
      if (type == "moof" || type == "mdat" || size < 8) return@use null
      offset += size
    }
    null
  }

  /** Calls [visit] with each child box's type and payload range within [start, end). */
  private inline fun children(data: ByteArray, start: Int, end: Int, visit: (String, Int, Int) -> Unit) {
    var at = start
    while (at + 8 <= end) {
      var size = u32(data, at)
      var header = 8
      if (size == 1L && at + 16 <= end) {
        size = u64(data, at + 8)
        header = 16
      } else if (size == 0L) {
        size = (end - at).toLong()
      }
      if (size < header || at + size > end) return
      visit(String(data, at + 4, 4, Charsets.ISO_8859_1), at + header, (at + size).toInt())
      at += size.toInt()
    }
  }

  private fun scale(value: Long, timescale: Long): Long = value * 1_000_000L / timescale

  private fun u32(data: ByteArray, at: Int): Long =
    ((data[at].toLong() and 0xFF) shl 24) or ((data[at + 1].toLong() and 0xFF) shl 16) or
      ((data[at + 2].toLong() and 0xFF) shl 8) or (data[at + 3].toLong() and 0xFF)

  private fun u64(data: ByteArray, at: Int): Long {
    var v = 0L
    for (i in 0 until 8) v = (v shl 8) or (data[at + i].toLong() and 0xFF)
    return v
  }

  private const val MAX_TOP_LEVEL_BOXES = 16
  private const val MAX_MOOV_BYTES = 8L * 1024 * 1024
  private const val MAX_EDITS = 64
}

/** The container of a downloaded track file, from its first bytes (how the engine reads it back). */
internal object TrackContainers {
  fun sniff(head: ByteArray): TrackContainer {
    if (head.size >= 1 && head[0].toInt() and 0xFF == 0x47 && (head.size <= 188 || head[188].toInt() and 0xFF == 0x47)) {
      return TrackContainer.TS
    }
    if (head.size >= 8 && String(head, 4, 4, Charsets.ISO_8859_1) in ISO_FIRST_BOXES) return TrackContainer.MP4
    if (head.size >= 4 && head[0] == 0x1A.toByte() && head[1] == 0x45.toByte() && head[2] == 0xDF.toByte() && head[3] == 0xA3.toByte()) {
      val text = String(head, 0, minOf(head.size, 256), Charsets.ISO_8859_1)
      return if (text.contains("webm")) TrackContainer.WEBM else TrackContainer.MKV
    }
    if (head.size >= 12 && String(head, 0, 4, Charsets.ISO_8859_1) == "RIFF" && String(head, 8, 4, Charsets.ISO_8859_1) == "AVI ") {
      return TrackContainer.AVI
    }
    if (head.size >= 3 && String(head, 0, 3, Charsets.ISO_8859_1) == "FLV") return TrackContainer.FLV
    // MP3, ADTS and anything else: Media3's default extractors sniff it.
    return TrackContainer.UNKNOWN
  }

  fun sniff(file: java.io.File): TrackContainer {
    if (!file.isFile) return TrackContainer.UNKNOWN
    val head = ByteArray(minOf(file.length(), 1024L).toInt())
    java.io.RandomAccessFile(file, "r").use { it.readFully(head) }
    return sniff(head)
  }

  private val ISO_FIRST_BOXES = setOf("ftyp", "styp", "moov", "moof", "sidx", "free", "skip", "wide", "mdat")
}
