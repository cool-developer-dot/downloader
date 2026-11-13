package com.vidorax.web.pdf

import android.net.Uri
import android.webkit.CookieManager
import java.io.File
import java.net.HttpURLConnection
import java.net.URL
import java.security.MessageDigest

/**
 * B17 #264 / #265 — PDFs the WebView would download: recognised by type or name (they go to JavaScript for the
 * "Open in VidoraX / Download / Open with another app" choice only while JS asks for them), and fetched for the
 * in-app viewer into `<cache>/pdf/` with the tab's own cookies (normal or incognito jar; looked up again for each
 * redirect hop, so another host never gets them). http(s) only, at most 5 redirects, 100 MB, timeouts, and the file
 * must start with `%PDF-`.
 */
internal object PdfFiles {
  const val DIR = "pdf"
  const val MAX_BYTES = 100L * 1024 * 1024
  private const val MAX_REDIRECTS = 5

  private val PDF_NAME = Regex("\\.pdf(\\?.*)?$", RegexOption.IGNORE_CASE)
  private val DISPOSITION_PDF = Regex("filename\\*?=[^;]*\\.pdf\"?\\s*(;|$)", RegexOption.IGNORE_CASE)

  fun isPdf(url: String, mimeType: String?, contentDisposition: String?): Boolean {
    val mime = mimeType?.substringBefore(';')?.trim()?.lowercase().orEmpty()
    if (mime == "application/pdf" || mime == "application/x-pdf") return true
    val generic = mime.isEmpty() || mime == "application/octet-stream" || mime == "binary/octet-stream" || mime == "application/download"
    if (!generic) return false
    if (contentDisposition != null && DISPOSITION_PDF.containsMatchIn(contentDisposition)) return true
    val path = try {
      Uri.parse(url).path.orEmpty()
    } catch (_: Exception) {
      ""
    }
    return PDF_NAME.containsMatchIn(path)
  }

  fun isPdfHeader(bytes: ByteArray, length: Int): Boolean =
    length >= 5 && bytes[0] == '%'.code.toByte() && bytes[1] == 'P'.code.toByte() && bytes[2] == 'D'.code.toByte() &&
      bytes[3] == 'F'.code.toByte() && bytes[4] == '-'.code.toByte()

  fun isHttp(url: String): Boolean = url.startsWith("https://", true) || url.startsWith("http://", true)

  fun cacheFile(cacheDir: File, url: String): File {
    val hash = MessageDigest.getInstance("SHA-1").digest(url.toByteArray()).joinToString("") { "%02x".format(it) }
    return File(File(cacheDir, DIR), "$hash.pdf")
  }

  fun isInCache(cacheDir: File, file: File): Boolean = try {
    file.canonicalFile.parentFile == File(cacheDir, DIR).canonicalFile && file.name.endsWith(".pdf")
  } catch (_: Exception) {
    false
  }

  sealed interface Fetch {
    data class Done(val file: File) : Fetch
    data class Failed(val reason: String) : Fetch
  }

  /** Blocking: call off the main thread. */
  fun fetch(url: String, userAgent: String?, jar: CookieManager?, target: File, open: (URL) -> HttpURLConnection = { it.openConnection() as HttpURLConnection }): Fetch {
    var current = url
    repeat(MAX_REDIRECTS + 1) {
      if (!isHttp(current)) return Fetch.Failed("unsafe")
      val connection = open(URL(current))
      try {
        connection.instanceFollowRedirects = false
        connection.connectTimeout = 15_000
        connection.readTimeout = 30_000
        userAgent?.let { connection.setRequestProperty("User-Agent", it) }
        jar?.getCookie(current)?.takeIf { it.isNotBlank() }?.let { connection.setRequestProperty("Cookie", it) }
        val code = connection.responseCode
        if (code in 300..399) {
          val location = connection.getHeaderField("Location") ?: return Fetch.Failed("http")
          current = URL(URL(current), location).toString()
          return@repeat
        }
        if (code !in 200..299) return Fetch.Failed("http")
        val length = connection.contentLengthLong
        if (length > MAX_BYTES) return Fetch.Failed("tooLarge")
        target.parentFile?.mkdirs()
        val temp = File(target.path + ".part")
        var total = 0L
        connection.inputStream.use { input ->
          temp.outputStream().use { output ->
            val buffer = ByteArray(64 * 1024)
            var first = true
            while (true) {
              val n = input.read(buffer)
              if (n < 0) break
              if (first) {
                if (!isPdfHeader(buffer, n)) {
                  output.close()
                  temp.delete()
                  return Fetch.Failed("notPdf")
                }
                first = false
              }
              total += n
              if (total > MAX_BYTES) {
                output.close()
                temp.delete()
                return Fetch.Failed("tooLarge")
              }
              output.write(buffer, 0, n)
            }
          }
        }
        if (total == 0L) {
          temp.delete()
          return Fetch.Failed("notPdf")
        }
        target.delete()
        return if (temp.renameTo(target)) Fetch.Done(target) else Fetch.Failed("io")
      } catch (_: java.io.IOException) {
        return Fetch.Failed("network")
      } finally {
        connection.disconnect()
      }
    }
    return Fetch.Failed("redirects")
  }
}
