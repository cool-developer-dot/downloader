package com.vidorax.media.archive

import com.vidorax.media.safety.ContentKind
import com.vidorax.media.safety.ContentSniff
import com.vidorax.media.safety.FileSafetyReason
import java.io.Closeable
import java.io.File
import java.io.IOException
import java.io.InputStream
import java.io.OutputStream
import java.io.RandomAccessFile
import java.util.Locale
import java.util.zip.CRC32
import java.util.zip.Inflater
import java.util.zip.InflaterInputStream

/** Random access to an archive's bytes. */
interface ArchiveSource : Closeable {
  val size: Long

  /** Reads up to [length] bytes at [position]; -1 at the end. */
  fun read(position: Long, buffer: ByteArray, offset: Int, length: Int): Int
}

class FileArchiveSource(file: File) : ArchiveSource {
  private val raf = RandomAccessFile(file, "r")
  override val size: Long = raf.length()

  override fun read(position: Long, buffer: ByteArray, offset: Int, length: Int): Int = synchronized(raf) {
    raf.seek(position)
    raf.read(buffer, offset, length)
  }

  override fun close() = raf.close()
}

class BytesArchiveSource(private val bytes: ByteArray) : ArchiveSource {
  override val size: Long get() = bytes.size.toLong()

  override fun read(position: Long, buffer: ByteArray, offset: Int, length: Int): Int {
    if (position >= bytes.size) return -1
    val count = minOf(length.toLong(), bytes.size - position).toInt()
    System.arraycopy(bytes, position.toInt(), buffer, offset, count)
    return count
  }

  override fun close() = Unit
}

/** Why an archive is not opened at all. */
enum class ArchiveRefusal(val wire: String) {
  NOT_ZIP("not_zip"),
  RAR("rar"),
  SEVEN_Z("seven_z"),
  ENCRYPTED("encrypted"),
  PATH_ESCAPE("path_escape"),
  TOO_MANY_ENTRIES("too_many_entries"),
  TOO_LARGE("too_large"),
  COMPRESSION_RATIO("compression_ratio"),
  DAMAGED("damaged"),

  /** The "archive" is an Android app (an APK renamed `.zip`). */
  ANDROID_APP("android_app"),
}

class ArchiveRefusedException(val refusal: ArchiveRefusal, message: String) : IOException(message)

/** What an entry is to VidoraX: only videos and subtitles are ever extracted. */
enum class ArchiveEntryKind(val wire: String) {
  VIDEO("video"),
  SUBTITLE("subtitle"),
  PROGRAM("program"),
  OTHER("other"),
}

data class ZipEntryInfo(
  val name: String,
  val compressedSize: Long,
  val uncompressedSize: Long,
  val method: Int,
  val crc: Long,
  val localHeaderOffset: Long,
  val kind: ArchiveEntryKind,
) {
  /** Stored or deflated: the two methods VidoraX reads. */
  val readable: Boolean get() = method == METHOD_STORED || method == METHOD_DEFLATED

  /** The entry's file name without its folders. */
  val baseName: String get() = name.substringAfterLast('/')

  companion object {
    const val METHOD_STORED = 0
    const val METHOD_DEFLATED = 8
  }
}

sealed interface ZipListing {
  data class Ok(val entries: List<ZipEntryInfo>, val totalUncompressed: Long) : ZipListing

  data class Refused(val refusal: ArchiveRefusal) : ZipListing
}

/**
 * P8 #407 Extract Archive: a ZIP's central directory read without trusting it. The whole archive is refused when an
 * entry is encrypted, a path leaves the extraction folder (`../`, `/`, `C:`), there are more than [MAX_ENTRIES]
 * entries, the files add up to more than [MAX_TOTAL_BYTES], or anything inflates more than [MAX_RATIO] times. Extraction
 * enforces the same limits on the bytes actually produced, so a header that lies cannot get past them. RAR and 7z
 * are recognised only to say they are not supported. Pure (no Android).
 */
object ZipArchive {
  const val MAX_ENTRIES = 1000
  const val MAX_TOTAL_BYTES = 4L * 1024 * 1024 * 1024
  const val MAX_RATIO = 100L

  /** Small entries (a page of subtitles, a text file of spaces) compress well and are no bomb. */
  const val RATIO_MIN_BYTES = 1L * 1024 * 1024

  private const val EOCD_SIG = 0x06054b50L
  private const val ZIP64_LOCATOR_SIG = 0x07064b50L
  private const val ZIP64_EOCD_SIG = 0x06064b50L
  private const val CENTRAL_SIG = 0x02014b50L
  private const val LOCAL_SIG = 0x04034b50L
  private const val EOCD_MIN = 22
  private const val MAX_COMMENT = 0xFFFF
  private const val FLAG_ENCRYPTED = 0x1
  private const val FLAG_STRONG_ENCRYPTION = 0x40
  private const val FLAG_UTF8 = 0x800
  private const val METHOD_AES = 99

  val VIDEO_EXTENSIONS = setOf(
    "mp4", "m4v", "mkv", "webm", "mov", "avi", "wmv", "flv", "f4v", "ts", "3gp", "3g2", "mpg", "mpeg", "vob", "divx",
  )
  val SUBTITLE_EXTENSIONS = setOf("srt", "vtt")

  fun list(source: ArchiveSource): ZipListing {
    val head = ByteArray(8)
    val headCount = readFully(source, 0, head, 0, head.size)
    val kind = ContentSniff.kindOf(head.copyOf(headCount))
    if (kind == ContentKind.RAR) return ZipListing.Refused(ArchiveRefusal.RAR)
    if (kind == ContentKind.SEVEN_Z) return ZipListing.Refused(ArchiveRefusal.SEVEN_Z)
    if (kind != ContentKind.ZIP && kind != ContentKind.APK && kind != ContentKind.JAR) {
      return ZipListing.Refused(ArchiveRefusal.NOT_ZIP)
    }
    val directory = findDirectory(source) ?: return ZipListing.Refused(ArchiveRefusal.DAMAGED)
    if (directory.entries > MAX_ENTRIES) return ZipListing.Refused(ArchiveRefusal.TOO_MANY_ENTRIES)
    if (directory.offset < 0 || directory.size < 0 || directory.offset + directory.size > source.size) {
      return ZipListing.Refused(ArchiveRefusal.DAMAGED)
    }
    if (directory.size > MAX_DIRECTORY_BYTES) return ZipListing.Refused(ArchiveRefusal.TOO_MANY_ENTRIES)
    val cd = ByteArray(directory.size.toInt())
    if (readFully(source, directory.offset, cd, 0, cd.size) != cd.size) return ZipListing.Refused(ArchiveRefusal.DAMAGED)

    val entries = ArrayList<ZipEntryInfo>()
    var position = 0
    var totalUncompressed = 0L
    var totalCompressed = 0L
    while (position < cd.size) {
      if (entries.size >= MAX_ENTRIES) return ZipListing.Refused(ArchiveRefusal.TOO_MANY_ENTRIES)
      if (position + 46 > cd.size || u32(cd, position) != CENTRAL_SIG) return ZipListing.Refused(ArchiveRefusal.DAMAGED)
      val flags = u16(cd, position + 8)
      val method = u16(cd, position + 10)
      val crc = u32(cd, position + 16)
      var compressed = u32(cd, position + 20)
      var uncompressed = u32(cd, position + 24)
      val nameLength = u16(cd, position + 28)
      val extraLength = u16(cd, position + 30)
      val commentLength = u16(cd, position + 32)
      var localOffset = u32(cd, position + 42)
      val nameStart = position + 46
      val extraStart = nameStart + nameLength
      val next = extraStart + extraLength + commentLength
      if (next > cd.size) return ZipListing.Refused(ArchiveRefusal.DAMAGED)

      if (uncompressed == MAX_U32 || compressed == MAX_U32 || localOffset == MAX_U32) {
        val zip64 = zip64Extra(cd, extraStart, extraLength, uncompressed == MAX_U32, compressed == MAX_U32, localOffset == MAX_U32)
          ?: return ZipListing.Refused(ArchiveRefusal.DAMAGED)
        uncompressed = zip64[0] ?: uncompressed
        compressed = zip64[1] ?: compressed
        localOffset = zip64[2] ?: localOffset
      }
      if (flags and (FLAG_ENCRYPTED or FLAG_STRONG_ENCRYPTION) != 0 || method == METHOD_AES) {
        return ZipListing.Refused(ArchiveRefusal.ENCRYPTED)
      }
      val name = decodeName(cd, nameStart, nameLength, flags and FLAG_UTF8 != 0)
      if (escapes(name)) return ZipListing.Refused(ArchiveRefusal.PATH_ESCAPE)
      if (uncompressed < 0 || compressed < 0 || localOffset < 0 || localOffset >= source.size) {
        return ZipListing.Refused(ArchiveRefusal.DAMAGED)
      }
      totalUncompressed += uncompressed
      totalCompressed += compressed
      if (totalUncompressed > MAX_TOTAL_BYTES) return ZipListing.Refused(ArchiveRefusal.TOO_LARGE)
      if (exceedsRatio(uncompressed, compressed)) return ZipListing.Refused(ArchiveRefusal.COMPRESSION_RATIO)
      if (method == ZipEntryInfo.METHOD_STORED && compressed != uncompressed) {
        return ZipListing.Refused(ArchiveRefusal.DAMAGED)
      }
      if (!name.endsWith('/')) {
        entries += ZipEntryInfo(name, compressed, uncompressed, method, crc, localOffset, kindOf(name))
      }
      position = next
    }
    if (exceedsRatio(totalUncompressed, totalCompressed)) return ZipListing.Refused(ArchiveRefusal.COMPRESSION_RATIO)
    if (entries.any { it.name == "AndroidManifest.xml" } && entries.any { it.name == "classes.dex" || it.name == "resources.arsc" }) {
      return ZipListing.Refused(ArchiveRefusal.ANDROID_APP)
    }
    return ZipListing.Ok(entries, totalUncompressed)
  }

  /**
   * Writes [entry]'s bytes to [out] and returns how many were written. Never more than the directory said (nor more
   * than [MAX_RATIO] times the stored bytes); a CRC that does not match is [ArchiveRefusal.DAMAGED].
   */
  fun extract(source: ArchiveSource, entry: ZipEntryInfo, out: OutputStream): Long {
    if (!entry.readable) throw ArchiveRefusedException(ArchiveRefusal.DAMAGED, "Unsupported compression method")
    val local = ByteArray(30)
    if (readFully(source, entry.localHeaderOffset, local, 0, local.size) != local.size || u32(local, 0) != LOCAL_SIG) {
      throw ArchiveRefusedException(ArchiveRefusal.DAMAGED, "Missing local header")
    }
    if (u16(local, 6) and (FLAG_ENCRYPTED or FLAG_STRONG_ENCRYPTION) != 0) {
      throw ArchiveRefusedException(ArchiveRefusal.ENCRYPTED, "Encrypted entry")
    }
    val dataStart = entry.localHeaderOffset + 30 + u16(local, 26) + u16(local, 28)
    if (dataStart + entry.compressedSize > source.size) throw ArchiveRefusedException(ArchiveRefusal.DAMAGED, "Entry runs past the end")
    val raw = RangeInputStream(source, dataStart, entry.compressedSize)
    val inflater = if (entry.method == ZipEntryInfo.METHOD_DEFLATED) Inflater(true) else null
    val input: InputStream = if (inflater != null) InflaterInputStream(raw, inflater, BUFFER_BYTES) else raw
    val limit = minOf(entry.uncompressedSize, maxOf(entry.compressedSize, 1L) * MAX_RATIO + RATIO_MIN_BYTES)
    val crc = CRC32()
    val buffer = ByteArray(BUFFER_BYTES)
    var written = 0L
    try {
      while (true) {
        val read = input.read(buffer)
        if (read < 0) break
        written += read
        if (written > limit) throw ArchiveRefusedException(ArchiveRefusal.COMPRESSION_RATIO, "Entry inflates past its stated size")
        crc.update(buffer, 0, read)
        out.write(buffer, 0, read)
      }
    } catch (e: java.util.zip.ZipException) {
      throw ArchiveRefusedException(ArchiveRefusal.DAMAGED, "Entry data is damaged")
    } catch (e: java.io.EOFException) {
      throw ArchiveRefusedException(ArchiveRefusal.DAMAGED, "Entry data ends early")
    } finally {
      inflater?.end()
    }
    if (written != entry.uncompressedSize || crc.value != entry.crc) {
      throw ArchiveRefusedException(ArchiveRefusal.DAMAGED, "Entry does not match its checksum")
    }
    return written
  }

  /** The first bytes of an entry's content (for the disguised-program check), at most [count]. */
  fun prefix(source: ArchiveSource, entry: ZipEntryInfo, count: Int = ContentSniff.PREFIX_BYTES): ByteArray {
    val out = java.io.ByteArrayOutputStream()
    val capped = object : OutputStream() {
      override fun write(b: Int) = write(byteArrayOf(b.toByte()), 0, 1)
      override fun write(b: ByteArray, off: Int, len: Int) {
        val room = count - out.size()
        if (room > 0) out.write(b, off, minOf(room, len))
        if (out.size() >= count) throw PrefixFull()
      }
    }
    try {
      extract(source, entry, capped)
    } catch (e: PrefixFull) {
      // Enough read.
    } catch (e: ArchiveRefusedException) {
      // A damaged entry still shows what it starts with.
    }
    return out.toByteArray()
  }

  private class PrefixFull : IOException()

  /** VIDEO and SUBTITLE by extension; PROGRAM by extension or a double extension; everything else OTHER. */
  fun kindOf(name: String): ArchiveEntryKind {
    val base = name.substringAfterLast('/')
    if (base.startsWith("._") || name.startsWith("__MACOSX/")) return ArchiveEntryKind.OTHER
    val verdict = ContentSniff.assess(base, null)
    if (verdict.reason == FileSafetyReason.DOUBLE_EXTENSION || verdict.reason == FileSafetyReason.PROGRAM) {
      return ArchiveEntryKind.PROGRAM
    }
    val extension = ContentSniff.extensionsOf(base).lastOrNull()?.lowercase(Locale.ROOT)
    return when (extension) {
      in VIDEO_EXTENSIONS -> ArchiveEntryKind.VIDEO
      in SUBTITLE_EXTENSIONS -> ArchiveEntryKind.SUBTITLE
      else -> ArchiveEntryKind.OTHER
    }
  }

  /** Absolute paths, drive letters, `..` segments and NULs would leave (or confuse) the extraction folder. */
  fun escapes(name: String): Boolean {
    if (name.isEmpty() || name.contains('\u0000')) return true
    val path = name.replace('\\', '/')
    if (path.startsWith("/") || Regex("^[A-Za-z]:").containsMatchIn(path)) return true
    return path.split('/').any { it == ".." }
  }

  private fun exceedsRatio(uncompressed: Long, compressed: Long): Boolean =
    uncompressed > RATIO_MIN_BYTES && uncompressed > maxOf(compressed, 1L) * MAX_RATIO

  private data class Directory(val entries: Long, val size: Long, val offset: Long)

  private fun findDirectory(source: ArchiveSource): Directory? {
    if (source.size < EOCD_MIN) return null
    val window = minOf(source.size, (EOCD_MIN + MAX_COMMENT).toLong()).toInt()
    val tail = ByteArray(window)
    val start = source.size - window
    if (readFully(source, start, tail, 0, window) != window) return null
    var at = window - EOCD_MIN
    while (at >= 0 && u32(tail, at) != EOCD_SIG) at--
    if (at < 0) return null
    var entries = u16(tail, at + 10).toLong()
    var size = u32(tail, at + 12)
    var offset = u32(tail, at + 16)
    if (entries == 0xFFFFL || size == MAX_U32 || offset == MAX_U32) {
      val locatorAt = start + at - 20
      if (locatorAt < 0) return null
      val locator = ByteArray(20)
      if (readFully(source, locatorAt, locator, 0, 20) != 20 || u32(locator, 0) != ZIP64_LOCATOR_SIG) return null
      val zip64At = u64(locator, 8)
      val record = ByteArray(56)
      if (zip64At < 0 || readFully(source, zip64At, record, 0, 56) != 56 || u32(record, 0) != ZIP64_EOCD_SIG) return null
      entries = u64(record, 32)
      size = u64(record, 40)
      offset = u64(record, 48)
    }
    return Directory(entries, size, offset)
  }

  /** The ZIP64 extra field's values, in the order the spec lists them, for the fields that overflowed. */
  private fun zip64Extra(
    cd: ByteArray,
    start: Int,
    length: Int,
    wantUncompressed: Boolean,
    wantCompressed: Boolean,
    wantOffset: Boolean,
  ): Array<Long?>? {
    var at = start
    val end = start + length
    while (at + 4 <= end) {
      val id = u16(cd, at)
      val size = u16(cd, at + 2)
      if (id == 0x0001) {
        var field = at + 4
        val fieldEnd = field + size
        val values = arrayOfNulls<Long>(3)
        if (wantUncompressed) { if (field + 8 > fieldEnd) return null; values[0] = u64(cd, field); field += 8 }
        if (wantCompressed) { if (field + 8 > fieldEnd) return null; values[1] = u64(cd, field); field += 8 }
        if (wantOffset) { if (field + 8 > fieldEnd) return null; values[2] = u64(cd, field) }
        return values
      }
      at += 4 + size
    }
    return null
  }

  private fun decodeName(bytes: ByteArray, start: Int, length: Int, utf8: Boolean): String {
    val slice = bytes.copyOfRange(start, start + length)
    if (utf8) return String(slice, Charsets.UTF_8)
    val decoder = Charsets.UTF_8.newDecoder()
      .onMalformedInput(java.nio.charset.CodingErrorAction.REPORT)
      .onUnmappableCharacter(java.nio.charset.CodingErrorAction.REPORT)
    return runCatching { decoder.decode(java.nio.ByteBuffer.wrap(slice)).toString() }
      .getOrElse { String(slice, Charsets.ISO_8859_1) }
  }

  private fun readFully(source: ArchiveSource, position: Long, buffer: ByteArray, offset: Int, length: Int): Int {
    var total = 0
    while (total < length) {
      val read = source.read(position + total, buffer, offset + total, length - total)
      if (read <= 0) break
      total += read
    }
    return total
  }

  private fun u16(b: ByteArray, at: Int): Int = (b[at].toInt() and 0xFF) or ((b[at + 1].toInt() and 0xFF) shl 8)

  private fun u32(b: ByteArray, at: Int): Long = (u16(b, at).toLong()) or (u16(b, at + 2).toLong() shl 16)

  private fun u64(b: ByteArray, at: Int): Long = u32(b, at) or (u32(b, at + 4) shl 32)

  private const val MAX_U32 = 0xFFFFFFFFL
  private const val BUFFER_BYTES = 1 shl 16

  /** A central directory this long holds far more than [MAX_ENTRIES] entries. */
  private const val MAX_DIRECTORY_BYTES = 4L * 1024 * 1024

  private class RangeInputStream(private val source: ArchiveSource, private var position: Long, private var remaining: Long) :
    InputStream() {
    override fun read(): Int {
      val one = ByteArray(1)
      return if (read(one, 0, 1) <= 0) -1 else one[0].toInt() and 0xFF
    }

    override fun read(b: ByteArray, off: Int, len: Int): Int {
      if (remaining <= 0) return -1
      val read = source.read(position, b, off, minOf(len.toLong(), remaining).toInt())
      if (read <= 0) return -1
      position += read
      remaining -= read
      return read
    }
  }
}
