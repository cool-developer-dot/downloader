package com.vidorax.media.safety

import java.util.Locale

/**
 * P8 #461 Malware Warning: what a file really is, judged by its first bytes (never by its name), and whether its name
 * hides that. Pure: no Android, no I/O. The JavaScript half (`src/downloads/safety/file-safety.ts`) turns a
 * [FileSafetyVerdict] into the warning text; the extension lists match `dangerous-download.ts` (H17).
 */
enum class ContentKind(val wire: String, val isProgram: Boolean) {
  APK("apk", true),
  JAR("jar", true),
  DEX("dex", true),
  EXE("exe", true),
  ELF("elf", true),
  MACHO("macho", true),
  MSI("msi", true),
  SCRIPT("script", true),
  ZIP("zip", false),
  RAR("rar", false),
  SEVEN_Z("7z", false),
}

/** Why a file needs the warning. */
enum class FileSafetyReason(val wire: String) {
  /** The name says video (or picture, document, subtitle) but the bytes are a program or an archive. */
  DISGUISED("disguised"),

  /** `clip.mp4.exe`: a harmless-looking extension in front of a program's. */
  DOUBLE_EXTENSION("double_extension"),

  /** An honestly named program (`setup.exe`). */
  PROGRAM("program"),
}

data class FileSafetyVerdict(val reason: FileSafetyReason?, val detected: ContentKind?) {
  val risky: Boolean get() = reason != null

  companion object {
    val SAFE = FileSafetyVerdict(null, null)
  }
}

object ContentSniff {
  /** Enough for every signature here, including an APK's first entry names. */
  const val PREFIX_BYTES = 4096

  /** Extensions of files that install an app or run a program (H17's list, `dangerous-download.ts`). */
  val PROGRAM_EXTENSIONS: Set<String> = setOf(
    "apk", "apks", "xapk", "exe", "msi", "bat", "cmd", "scr", "jar", "vbs", "sh", "dex",
    "com", "pif", "ps1", "hta", "wsf", "cpl", "lnk",
  )

  /** Names a person reads as "just a video / picture / document / subtitle". */
  val HARMLESS_EXTENSIONS: Set<String> = setOf(
    "mp4", "m4v", "mkv", "webm", "mov", "avi", "wmv", "flv", "f4v", "ts", "3gp", "3g2", "mpg", "mpeg", "vob", "divx",
    "mp3", "m4a", "aac", "wav", "ogg", "opus",
    "jpg", "jpeg", "png", "gif", "webp", "heic", "bmp",
    "pdf", "txt", "doc", "docx", "xls", "xlsx", "ppt", "pptx",
    "srt", "vtt", "ass", "ssa", "sub",
  )

  private val ZIP_LOCAL = byteArrayOf(0x50, 0x4B, 0x03, 0x04)
  private val ZIP_EMPTY = byteArrayOf(0x50, 0x4B, 0x05, 0x06)
  private val ZIP_SPANNED = byteArrayOf(0x50, 0x4B, 0x07, 0x08)
  private val RAR = byteArrayOf(0x52, 0x61, 0x72, 0x21, 0x1A, 0x07)
  private val SEVEN_Z = byteArrayOf(0x37, 0x7A, 0xBC.toByte(), 0xAF.toByte(), 0x27, 0x1C)
  private val ELF = byteArrayOf(0x7F, 0x45, 0x4C, 0x46)
  private val DEX = byteArrayOf(0x64, 0x65, 0x78, 0x0A)
  private val OLE = byteArrayOf(0xD0.toByte(), 0xCF.toByte(), 0x11, 0xE0.toByte(), 0xA1.toByte(), 0xB1.toByte(), 0x1A, 0xE1.toByte())
  private val MACHO = listOf(
    byteArrayOf(0xFE.toByte(), 0xED.toByte(), 0xFA.toByte(), 0xCE.toByte()),
    byteArrayOf(0xFE.toByte(), 0xED.toByte(), 0xFA.toByte(), 0xCF.toByte()),
    byteArrayOf(0xCE.toByte(), 0xFA.toByte(), 0xED.toByte(), 0xFE.toByte()),
    byteArrayOf(0xCF.toByte(), 0xFA.toByte(), 0xED.toByte(), 0xFE.toByte()),
  )

  /** What [prefix] (a file's first bytes) is, when it is a program or an archive; null for anything else. */
  fun kindOf(prefix: ByteArray): ContentKind? {
    if (prefix.startsWith(ZIP_LOCAL) || prefix.startsWith(ZIP_EMPTY) || prefix.startsWith(ZIP_SPANNED)) {
      return zipKind(prefix)
    }
    if (prefix.startsWith(RAR)) return ContentKind.RAR
    if (prefix.startsWith(SEVEN_Z)) return ContentKind.SEVEN_Z
    if (prefix.startsWith(ELF)) return ContentKind.ELF
    if (prefix.startsWith(DEX) && prefix.size >= 8 && prefix[7] == 0.toByte()) return ContentKind.DEX
    if (prefix.startsWith(OLE)) return ContentKind.MSI
    if (MACHO.any { prefix.startsWith(it) }) return ContentKind.MACHO
    if (prefix.size >= 2 && prefix[0] == 'M'.code.toByte() && prefix[1] == 'Z'.code.toByte() && isPe(prefix)) {
      return ContentKind.EXE
    }
    if (prefix.size >= 3 && prefix[0] == '#'.code.toByte() && prefix[1] == '!'.code.toByte() && prefix[2] == '/'.code.toByte()) {
      return ContentKind.SCRIPT
    }
    return null
  }

  /**
   * The verdict for a file called [name] whose first bytes are [prefix] (null when the bytes are not known yet, as
   * for a download that has not started).
   */
  fun assess(name: String?, prefix: ByteArray?): FileSafetyVerdict {
    val detected = prefix?.let(::kindOf)
    val extensions = extensionsOf(name)
    val last = extensions.lastOrNull()
    if (extensions.size >= 2 && last in PROGRAM_EXTENSIONS && extensions[extensions.size - 2] in HARMLESS_EXTENSIONS) {
      return FileSafetyVerdict(FileSafetyReason.DOUBLE_EXTENSION, detected)
    }
    if (detected != null && last in HARMLESS_EXTENSIONS) return FileSafetyVerdict(FileSafetyReason.DISGUISED, detected)
    if (detected?.isProgram == true) return FileSafetyVerdict(FileSafetyReason.PROGRAM, detected)
    if (last in PROGRAM_EXTENSIONS) return FileSafetyVerdict(FileSafetyReason.PROGRAM, detected)
    return FileSafetyVerdict.SAFE
  }

  /** `Clip.MP4.exe` → [mp4, exe]; at most the last three dot-separated parts, each a plain short extension. */
  fun extensionsOf(name: String?): List<String> {
    val base = name?.trim()?.split('/', '\\')?.lastOrNull()?.trimEnd('.', ' ') ?: return emptyList()
    val parts = base.split('.')
    if (parts.size < 2 || parts.first().isEmpty() && parts.size == 2) return emptyList()
    return parts.drop(1).takeLast(3).map { it.trim().lowercase(Locale.ROOT) }
      .takeLastWhile { it.isNotEmpty() && it.length <= 5 && it.all(Char::isLetterOrDigit) }
  }

  /** `MZ` with `e_lfanew` pointing at `PE\0\0` inside [prefix]; plain `MZ` (a DOS program) when it points beyond. */
  private fun isPe(prefix: ByteArray): Boolean {
    if (prefix.size < 0x40) return true
    val offset = (prefix[0x3C].toInt() and 0xFF) or ((prefix[0x3D].toInt() and 0xFF) shl 8) or
      ((prefix[0x3E].toInt() and 0xFF) shl 16) or ((prefix[0x3F].toInt() and 0xFF) shl 24)
    if (offset < 0x40 || offset + 4 > prefix.size) return true
    return prefix[offset] == 'P'.code.toByte() && prefix[offset + 1] == 'E'.code.toByte() &&
      prefix[offset + 2] == 0.toByte() && prefix[offset + 3] == 0.toByte()
  }

  /** A ZIP is an APK or a JAR when one of its first entries says so (the whole file is checked by ZipArchive). */
  private fun zipKind(prefix: ByteArray): ContentKind {
    val text = String(prefix, Charsets.ISO_8859_1)
    return when {
      APK_MARKERS.any { text.contains(it) } -> ContentKind.APK
      text.contains("META-INF/MANIFEST.MF") -> ContentKind.JAR
      else -> ContentKind.ZIP
    }
  }

  /** Entry names only an Android app has. */
  val APK_MARKERS = listOf("AndroidManifest.xml", "classes.dex", "resources.arsc")

  private fun ByteArray.startsWith(signature: ByteArray): Boolean =
    size >= signature.size && signature.indices.all { this[it] == signature[it] }
}
