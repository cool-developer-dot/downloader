package com.vidorax.media.net

import android.os.Build
import com.vidorax.media.model.BasicCredentials
import com.vidorax.media.model.ProbeFailure
import java.io.IOException
import java.io.InputStream
import java.net.URI
import java.net.URISyntaxException
import java.time.Duration
import javax.net.ssl.SSLContext
import javax.net.ssl.SSLException
import org.apache.commons.net.ftp.FTP
import org.apache.commons.net.ftp.FTPClient
import org.apache.commons.net.ftp.FTPReply
import org.apache.commons.net.ftp.FTPSClient

/**
 * #304: an `ftp://` or `ftps://` link, parsed once. [path] is the decoded path relative to the login directory
 * (RFC 1738: the leading `/` only separates it from the host; `%2F` spells an absolute one). The user name and
 * password of a link that carries them are kept apart ([credentials]) and never part of [redacted] or [withoutUserInfo].
 */
internal class FtpUrl private constructor(
  val scheme: String,
  val host: String,
  val port: Int,
  val path: String,
  val credentials: BasicCredentials?,
) {
  /** TLS from the first byte (`ftps://`, port 990), with a verified certificate. */
  val implicitTls: Boolean get() = scheme == "ftps"

  /** The origin sign-in is pinned to (net/DownloadCredentials). */
  val origin: String get() = "$scheme://${hostForUrl()}:$port"

  /** The link with no user name or password: what a download row stores and what is shown. */
  val withoutUserInfo: String
    get() {
      val defaultPort = if (implicitTls) IMPLICIT_PORT else DEFAULT_PORT
      val portPart = if (port == defaultPort) "" else ":$port"
      val encodedPath = path.split('/').joinToString("/") { encodeSegment(it) }
      return "$scheme://${hostForUrl()}$portPart/$encodedPath"
    }

  /** Safe for a log line or an exception message: no user name, no password, no query. */
  val redacted: String get() = withoutUserInfo

  /** The file's name, for a download's title. */
  val fileName: String get() = path.substringAfterLast('/').ifBlank { host }

  private fun hostForUrl(): String = if (host.contains(':')) "[$host]" else host

  override fun toString(): String = "FtpUrl($redacted)"

  companion object {
    const val DEFAULT_PORT = 21
    const val IMPLICIT_PORT = 990

    fun isFtp(raw: String?): Boolean {
      val text = raw?.trim()?.lowercase() ?: return false
      return text.startsWith("ftp://") || text.startsWith("ftps://")
    }

    /** Null when [raw] is not a usable ftp(s) link (no host, no file path, a control character). */
    fun parse(raw: String?): FtpUrl? {
      val text = raw?.trim() ?: return null
      if (!isFtp(text) || text.any { it.isISOControl() || it == ' ' }) return null
      val uri = try {
        URI(text)
      } catch (e: URISyntaxException) {
        return null
      }
      val scheme = uri.scheme?.lowercase() ?: return null
      val host = uri.host?.removePrefix("[")?.removeSuffix("]")?.lowercase()?.ifBlank { null } ?: return null
      val port = if (uri.port in 1..65535) uri.port else if (scheme == "ftps") IMPLICIT_PORT else DEFAULT_PORT
      if (uri.port != -1 && uri.port !in 1..65535) return null
      // `;type=i` (RFC 1738) only says "binary", which every download is.
      val rawPath = (uri.rawPath ?: "").substringBefore(';')
      val path = decode(rawPath).removePrefix("/")
      if (path.isBlank() || path.endsWith("/")) return null
      val credentials = uri.rawUserInfo?.let { info ->
        val user = decode(info.substringBefore(':'))
        val password = if (':' in info) decode(info.substringAfter(':')) else ""
        if (user.isEmpty() || user.length > 256 || password.length > 256) return null
        if (user.any { it.isISOControl() } || password.any { it.isISOControl() }) return null
        BasicCredentials(user, password)
      }
      return FtpUrl(scheme, host, port, path, credentials)
    }

    private fun decode(value: String): String = try {
      java.net.URLDecoder.decode(value.replace("+", "%2B"), "UTF-8")
    } catch (e: IllegalArgumentException) {
      value
    }

    private fun encodeSegment(segment: String): String = buildString {
      for (byte in segment.toByteArray(Charsets.UTF_8)) {
        val c = byte.toInt() and 0xFF
        val ch = c.toChar()
        if (ch.isLetterOrDigit() && c < 0x80 || ch in "-._~!$&'()*+,=@") append(ch) else append("%%%02X".format(c))
      }
    }
  }
}

/** Whether the downloader may connect to an FTP host: the same private-network rule as HTTP ([UrlSafety]). */
internal fun interface FtpHostPolicy {
  fun allows(host: String): Boolean

  companion object {
    val PUBLIC_ONLY = FtpHostPolicy { !UrlSafety.isPrivateOrLocalHost(it) }

    /** Tests serve their files from a loopback FTP server. */
    val ALLOW_ALL = FtpHostPolicy { true }
  }
}

/**
 * A negative FTP reply, carried as the HTTP status the engine already classifies ([MediaHttpException]), so FTP needs
 * no error path of its own: 530 (not logged in) → 401, 550/553 (no such file) → 404, a transient 4xx → 503 (waited
 * out), anything else → 400. The message holds the reply code only — a reply can echo the user name.
 */
internal object FtpReplies {
  fun failure(replyCode: Int, url: FtpUrl): MediaHttpException = MediaHttpException(httpStatusFor(replyCode), "${url.redacted} (FTP $replyCode)")

  fun httpStatusFor(replyCode: Int): Int = when {
    replyCode == 530 || replyCode == 532 -> 401
    replyCode == 550 || replyCode == 553 || replyCode == 450 -> 404
    replyCode in 400..499 -> 503
    else -> 400
  }
}

/** How to reach an FTP server; [sslContext] verifies certificates (the system's trust store unless a test gives one). */
internal class FtpConnector(
  private val policy: FtpHostPolicy = FtpHostPolicy.PUBLIC_ONLY,
  private val sslContext: () -> SSLContext = { SSLContext.getDefault() },
  private val connectTimeoutMs: Int = 20_000,
  private val readTimeoutMs: Int = 30_000,
  /**
   * Android 8+ only: Commons Net's FTPClient has `java.time` fields that do not exist on Android 7. (0 is a JVM unit
   * test's android.jar, never a device.)
   */
  private val supported: () -> Boolean = { Build.VERSION.SDK_INT >= Build.VERSION_CODES.O || Build.VERSION.SDK_INT == 0 },
) {
  /**
   * Runs [block] on a signed-in session and closes it. A server that refuses an encrypted data connection (one that
   * insists on TLS session reuse, which Java's FTPS client does not do) is asked once more with a clear data
   * connection; the control connection, and so the password, stays encrypted.
   */
  fun <T> withSession(url: FtpUrl, login: BasicCredentials?, block: (FtpSession) -> T): T {
    val first = open(url, login)
    try {
      return block(first)
    } catch (e: DataTlsRefused) {
      first.close()
      return open(url, login, protectData = false).use(block)
    } finally {
      first.close()
    }
  }

  /**
   * Connects and signs in. `ftp://` asks for TLS (AUTH TLS) first and stays plain only when the server does not offer
   * it or its certificate cannot be verified — the user asked for plain FTP, and an unverified TLS session would add
   * no protection worth a trust-all trust manager; `ftps://` is TLS from the start and never falls back. The data
   * connection always goes to the control connection's own address, never to the one a PASV reply names (a server
   * must not be able to point the downloader at another host).
   */
  fun open(url: FtpUrl, login: BasicCredentials?, protectData: Boolean = true): FtpSession {
    if (!supported()) throw MediaRefusedException(ProbeFailure.UNSUPPORTED_FORMAT, "FTP downloads need Android 8 or later")
    if (!policy.allows(url.host)) {
      throw MediaRefusedException(ProbeFailure.POLICY_BLOCKED, "refused non-public address ${url.redacted}")
    }
    val credentials = login ?: url.credentials ?: ANONYMOUS
    if (url.implicitTls) return connect(url, credentials, FTPSClient(true, sslContext()), protectData)
    return try {
      connect(url, credentials, FTPSClient(false, sslContext()), protectData)
    } catch (e: TlsUnavailable) {
      connect(url, credentials, FTPClient(), protectData = false)
    }
  }

  /** The server refused AUTH TLS or its certificate did not verify: only for `ftp://`, which then goes plain. */

  private class TlsUnavailable(cause: Throwable) : IOException(cause)

  private fun connect(url: FtpUrl, login: BasicCredentials, client: FTPClient, protectData: Boolean): FtpSession {
    val tls = client is FTPSClient
    client.connectTimeout = connectTimeoutMs
    client.defaultTimeout = readTimeoutMs
    client.setDataTimeout(Duration.ofMillis(readTimeoutMs.toLong()))
    client.controlEncoding = "UTF-8"
    client.isIpAddressFromPasvResponse = false
    if (client is FTPSClient) client.isEndpointCheckingEnabled = true
    try {
      client.connect(url.host, url.port)
    } catch (e: SSLException) {
      disconnect(client)
      if (!url.implicitTls) throw TlsUnavailable(e)
      throw MediaNetworkException("TLS with ${url.redacted} failed", e)
    } catch (e: IOException) {
      disconnect(client)
      throw MediaNetworkException("could not reach ${url.redacted}", e)
    }
    try {
      if (!FTPReply.isPositiveCompletion(client.replyCode)) throw FtpReplies.failure(client.replyCode, url)
      if (!client.login(login.username, login.password)) throw FtpReplies.failure(client.replyCode, url)
      var protectedData = false
      if (client is FTPSClient) {
        // Encrypt the data connection too when the server agrees; a server that will not keeps a clear one.
        protectedData = runCatching {
          client.execPBSZ(0)
          client.execPROT(if (protectData) "P" else "C")
          protectData
        }.getOrDefault(false)
      }
      if (!client.setFileType(FTP.BINARY_FILE_TYPE)) throw FtpReplies.failure(client.replyCode, url)
      client.enterLocalPassiveMode()
      return FtpSession(client, url, tls, protectedData)
    } catch (e: MediaHttpException) {
      disconnect(client)
      throw e
    } catch (e: IOException) {
      disconnect(client)
      throw MediaNetworkException("FTP session with ${url.redacted} failed", e)
    }
  }

  companion object {
    private val ANONYMOUS = BasicCredentials("anonymous", "anonymous@")

    internal fun disconnect(client: FTPClient) {
      runCatching { if (client.isConnected) client.disconnect() }
    }
  }
}

/** The server would not open an encrypted data connection: [FtpConnector.withSession] retries with a clear one. */
internal class DataTlsRefused(cause: Throwable?) : IOException("encrypted FTP data connection refused", cause)

/** One signed-in FTP control connection. Not thread-safe; one transfer at a time. */
internal class FtpSession(
  private val client: FTPClient,
  val url: FtpUrl,
  /** The control connection is encrypted. */
  val tls: Boolean,
  /** The data connection is encrypted too (PROT P). */
  private val protectedData: Boolean,
) : java.io.Closeable {
  /** The file's size in bytes (SIZE), or null when the server will not say. */
  fun size(): Long? = runCatching { client.getSize(url.path)?.trim()?.toLongOrNull() }.getOrNull()?.takeIf { it >= 0 }

  /** MDTM's timestamp (`YYYYMMDDhhmmss`), or null. */
  fun modified(): String? = runCatching { client.getModificationTime(url.path)?.trim()?.ifBlank { null } }.getOrNull()

  /** The server says it can restart a transfer at an offset (FEAT `REST STREAM`). */
  fun canResume(): Boolean = runCatching { client.hasFeature("REST", "STREAM") }.getOrDefault(false)

  /**
   * The file from [offset] on. A server that refuses the offset (REST) gets null back for the caller to start at 0.
   * A data connection that fails under PROT P throws [DataTlsRefused] ([FtpConnector.withSession] then reconnects).
   */
  fun retrieve(offset: Long): InputStream? {
    client.restartOffset = offset
    val stream = try {
      client.retrieveFileStream(url.path)
    } catch (e: SSLException) {
      if (protectedData) throw DataTlsRefused(e)
      throw MediaNetworkException("FTP data connection to ${url.redacted} failed", e)
    } catch (e: IOException) {
      throw MediaNetworkException("FTP data connection to ${url.redacted} failed", e)
    }
    if (stream != null) return stream
    val code = client.replyCode
    if (offset > 0 && code in 500..504) return null
    if (protectedData && code in DATA_TLS_REFUSALS) throw DataTlsRefused(null)
    throw FtpReplies.failure(code, url)
  }

  /** After a stream from [retrieve] was read to its end and closed: the server's verdict on the transfer. */
  fun completed(): Boolean = runCatching { client.completePendingCommand() }.getOrDefault(false)

  override fun close() {
    runCatching { if (client.isConnected) client.logout() }
    FtpConnector.disconnect(client)
  }

  /** Aborts at once, from any thread (a pause): the sockets are closed, nothing waits for the server. */
  fun abort() {
    FtpConnector.disconnect(client)
  }

  private companion object {
    /** Replies to a data connection a server refused under PROT P (TLS session reuse required, TLS failed). */
    val DATA_TLS_REFUSALS = setOf(425, 426, 522, 534)
  }
}
