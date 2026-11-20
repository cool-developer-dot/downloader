package com.vidorax.media.net

import com.vidorax.media.model.BasicCredentials
import com.vidorax.media.model.Container
import com.vidorax.media.model.ProbeFailure
import com.vidorax.media.model.ProbeResult
import com.vidorax.media.model.RequestContext
import com.vidorax.media.model.SourceKind
import com.vidorax.media.plan.FtpProbe
import com.vidorax.media.transfer.FtpTransfer
import com.vidorax.media.transfer.ResumeValidator
import com.vidorax.media.transfer.TransferSpec
import java.io.File
import java.net.ServerSocket
import java.security.KeyStore
import java.util.concurrent.CopyOnWriteArrayList
import javax.net.ssl.SSLContext
import javax.net.ssl.TrustManagerFactory
import kotlinx.coroutines.runBlocking
import org.apache.ftpserver.FtpServer
import org.apache.ftpserver.FtpServerFactory
import org.apache.ftpserver.ftplet.DefaultFtplet
import org.apache.ftpserver.ftplet.FtpRequest
import org.apache.ftpserver.ftplet.FtpSession as ServerSession
import org.apache.ftpserver.ftplet.FtpletResult
import org.apache.ftpserver.listener.ListenerFactory
import org.apache.ftpserver.ssl.SslConfigurationFactory
import org.apache.ftpserver.usermanager.impl.BaseUser
import org.apache.ftpserver.usermanager.impl.WritePermission
import org.junit.After
import org.junit.Assert.assertArrayEquals
import org.junit.Assert.assertEquals
import org.junit.Assert.assertFalse
import org.junit.Assert.assertNotNull
import org.junit.Assert.assertNull
import org.junit.Assert.assertTrue
import org.junit.Before
import org.junit.Rule
import org.junit.Test
import org.junit.rules.TemporaryFolder

/**
 * #304 FTP/FTPS against an in-process Apache FtpServer: link parsing and redaction, the probe's classification
 * (video only, sign-in, missing files, the private-network rule), the transfer with byte-offset resume and restart of a
 * changed file, and explicit/implicit TLS with a verified certificate.
 */
class FtpSourceTest {
  @get:Rule val tmp = TemporaryFolder()

  private var server: FtpServer? = null
  private var port = 0
  private val commands = CopyOnWriteArrayList<String>()
  private lateinit var home: File
  private val context = RequestContext(null, null, null, emptyMap(), useCookies = false)

  /** Trusts the test server's own certificate (a real trust check, not trust-all). */
  private val trusted: () -> SSLContext = {
    val store = KeyStore.getInstance("PKCS12").apply { KEYSTORE.inputStream().use { load(it, PASSWORD) } }
    val tmf = TrustManagerFactory.getInstance(TrustManagerFactory.getDefaultAlgorithm()).apply { init(store) }
    SSLContext.getInstance("TLS").apply { init(null, tmf.trustManagers, null) }
  }

  private val connector get() = FtpConnector(policy = FtpHostPolicy.ALLOW_ALL, sslContext = trusted)

  @Before fun setUp() {
    home = tmp.newFolder("ftp-home")
    resource("media/formats/av.mkv").copyTo(File(home, "video.mkv"))
    resource("media/formats/audio.m4a").copyTo(File(home, "song.m4a"))
    resource("media/formats/cenc-moov-at-end.mp4").copyTo(File(home, "protected.mp4"))
    File(home, "notes.txt").writeText("not a video at all\n".repeat(50))
    File(home, "sub dir").mkdirs()
    resource("media/formats/av.mkv").copyTo(File(home, "sub dir/clip ü.mkv"))
    DownloadCredentials.resetForTests()
  }

  @After fun tearDown() {
    server?.stop()
    DownloadCredentials.resetForTests()
  }

  private fun resource(path: String): File = File(javaClass.classLoader!!.getResource(path)!!.toURI())

  private fun start(tls: Tls = Tls.NONE) {
    port = ServerSocket(0).use { it.localPort }
    val factory = FtpServerFactory()
    val listener = ListenerFactory().apply {
      port = this@FtpSourceTest.port
      serverAddress = "127.0.0.1"
      if (tls != Tls.NONE) {
        sslConfiguration = SslConfigurationFactory().apply {
          keystoreFile = KEYSTORE
          keystoreType = "PKCS12"
          keystorePassword = String(PASSWORD)
          keyPassword = String(PASSWORD)
        }.createSslConfiguration()
        isImplicitSsl = tls == Tls.IMPLICIT
      }
    }
    factory.addListener("default", listener.createListener())
    factory.userManager.save(user("anonymous", null))
    factory.userManager.save(user("alice", "s3cret word"))
    // FtpServer changes this map itself (an immutable one closes every session).
    factory.ftplets = linkedMapOf<String, org.apache.ftpserver.ftplet.Ftplet>(
      "log" to object : DefaultFtplet() {
        override fun beforeCommand(session: ServerSession, request: FtpRequest): FtpletResult {
          commands += request.command
          return FtpletResult.DEFAULT
        }
      },
    )
    server = factory.createServer().apply { start() }
  }

  private enum class Tls { NONE, EXPLICIT, IMPLICIT }

  private fun user(name: String, password: String?) = BaseUser().apply {
    this.name = name
    this.password = password
    homeDirectory = home.path
    authorities = listOf(WritePermission())
  }

  private fun url(path: String, user: String = "", scheme: String = "ftp") = "$scheme://${user}127.0.0.1:$port/$path"

  // --- links ---

  @Test fun anFtpLinkKeepsItsSignInApartFromWhatIsStoredOrShown() {
    val parsed = FtpUrl.parse("ftp://al%40ice:p%3Ass@Files.Example.com:2121/pub/My%20Clip.mp4;type=i")!!
    assertEquals("files.example.com", parsed.host)
    assertEquals(2121, parsed.port)
    assertEquals("pub/My Clip.mp4", parsed.path)
    assertEquals("al@ice", parsed.credentials!!.username)
    assertEquals("p:ss", parsed.credentials!!.password)
    assertEquals("ftp://files.example.com:2121/pub/My%20Clip.mp4", parsed.withoutUserInfo)
    assertFalse(parsed.redacted.contains("p:ss") || parsed.redacted.contains("ice"))
    assertEquals("ftp://files.example.com:2121/pub/My%20Clip.mp4", Redact.url("ftp://al%40ice:p%3Ass@files.example.com:2121/pub/My%20Clip.mp4"))
    assertEquals("ftp://files.example.com:2121", parsed.origin)

    val implicit = FtpUrl.parse("ftps://host.example/v.mkv")!!
    assertEquals(FtpUrl.IMPLICIT_PORT, implicit.port)
    assertTrue(implicit.implicitTls)
    assertEquals(FtpUrl.DEFAULT_PORT, FtpUrl.parse("ftp://host.example/v.mkv")!!.port)

    assertNull("a folder is not a file", FtpUrl.parse("ftp://host.example/pub/"))
    assertNull("no path", FtpUrl.parse("ftp://host.example"))
    assertNull(FtpUrl.parse("https://host.example/v.mp4"))
    assertNull(FtpUrl.parse("ftp:///v.mp4"))
  }

  // --- probe ---

  @Test fun aVideoFileIsDownloadable() {
    start()
    val result = FtpProbe(connector).probe(url("video.mkv"), context) as ProbeResult.Success
    assertEquals(SourceKind.FTP, result.kind)
    assertEquals(Container.MKV, result.container)
    assertEquals(File(home, "video.mkv").length(), result.sizeBytes)
    assertTrue(result.resumable)
    assertEquals(url("video.mkv"), result.finalUrl)
  }

  @Test fun aPathWithSpacesAndNonAsciiIsFound() {
    start()
    val result = FtpProbe(connector).probe(url("sub%20dir/clip%20%C3%BC.mkv"), context)
    assertTrue(result.toString(), result is ProbeResult.Success)
  }

  @Test fun onlyVideoIsAccepted() {
    start()
    val audio = FtpProbe(connector).probe(url("song.m4a"), context) as ProbeResult.Failure
    assertEquals(ProbeFailure.UNSUPPORTED_FORMAT, audio.reason)
    val text = FtpProbe(connector).probe(url("notes.txt"), context) as ProbeResult.Failure
    assertTrue(text.reason == ProbeFailure.NOT_MEDIA || text.reason == ProbeFailure.UNSUPPORTED_FORMAT)
    // Its encryption boxes are after the media data: read with a REST offset, and refused as protected.
    val protected = FtpProbe(connector).probe(url("protected.mp4"), context) as ProbeResult.Failure
    assertEquals(ProbeFailure.DRM_PROTECTED, protected.reason)
    assertTrue(commands.contains("REST"))
  }

  @Test fun signInFromTheLinkOrFromTheDownloadsCredentials() {
    start()
    val withLink = FtpProbe(connector).probe(url("video.mkv", user = "alice:s3cret%20word@"), context)
    assertTrue(withLink is ProbeResult.Success)
    assertFalse("the result never carries the password", (withLink as ProbeResult.Success).finalUrl.contains("s3cret"))

    // A download's own sign-in, pinned to its FTP origin (net/DownloadCredentials, memory only).
    assertTrue(DownloadCredentials.put("dl-1", url("video.mkv"), BasicCredentials("alice", "s3cret word")))
    val withKey = FtpProbe(connector).probe(url("video.mkv"), context.copy(authKey = "dl-1"))
    assertTrue(withKey is ProbeResult.Success)
    // An FTP sign-in is never an http(s) Authorization header.
    assertNull(DownloadCredentials.authorizationFor("dl-1", okhttp3.HttpUrl.Builder().scheme("https").host("127.0.0.1").port(port).build()))
    assertNull("another server does not get it", DownloadCredentials.ftpLoginFor("dl-1", FtpUrl.parse("ftp://other.example/video.mkv")!!))

    val wrong = FtpProbe(connector).probe(url("video.mkv", user = "alice:nope@"), context) as ProbeResult.Failure
    assertEquals(ProbeFailure.HTTP_403, wrong.reason)
    assertEquals(401, wrong.httpStatus)
    assertFalse(wrong.message.orEmpty().contains("nope"))
  }

  @Test fun aMissingFileIsNotFound() {
    start()
    val missing = FtpProbe(connector).probe(url("gone.mp4"), context) as ProbeResult.Failure
    assertEquals(ProbeFailure.HTTP_404, missing.reason)
  }

  @Test fun aPrivateHostIsRefusedBeforeAnyConnection() {
    start()
    val refused = FtpProbe(FtpConnector()).probe(url("video.mkv"), context) as ProbeResult.Failure
    assertEquals(ProbeFailure.POLICY_BLOCKED, refused.reason)
    assertTrue("nothing reached the server", commands.isEmpty())
    assertFalse(FtpHostPolicy.PUBLIC_ONLY.allows("192.168.1.10"))
    assertTrue(FtpHostPolicy.PUBLIC_ONLY.allows("ftp.example.com"))
  }

  @Test fun androidSevenRefusesFtpInsteadOfCrashing() {
    start()
    val old = FtpConnector(policy = FtpHostPolicy.ALLOW_ALL, supported = { false })
    val refused = FtpProbe(old).probe(url("video.mkv"), context) as ProbeResult.Failure
    assertEquals(ProbeFailure.UNSUPPORTED_FORMAT, refused.reason)
  }

  // --- transfer ---

  private fun spec(path: String, partFile: File = File(tmp.root, "work/download.part")) =
    TransferSpec(url = url(path), context = context, partFile = partFile.apply { parentFile?.mkdirs() })

  @Test fun aFileIsDownloadedWholeAndAPartialResumesAtItsLength() = runBlocking {
    start()
    val source = File(home, "video.mkv").readBytes()
    val first = spec("video.mkv")
    val outcome = FtpTransfer(connector).transfer(first)
    assertArrayEquals(source, first.partFile.readBytes())
    assertEquals(source.size.toLong(), outcome.totalBytes)
    val validator = ResumeValidator.read(first.partFile)
    assertNotNull(validator)
    assertTrue(validator, validator!!.startsWith("ftp ${source.size} "))

    // A partial of the same file continues at its length (REST), never from 0.
    commands.clear()
    val half = source.size / 2
    java.io.RandomAccessFile(first.partFile, "rw").use { it.setLength(half.toLong()) }
    val progress = CopyOnWriteArrayList<Long>()
    FtpTransfer(connector).transfer(first) { bytes, _ -> progress += bytes }
    assertArrayEquals(source, first.partFile.readBytes())
    assertTrue(commands.contains("REST"))
    assertTrue("progress starts from the bytes on disk", progress.first() > half)
  }

  @Test fun aChangedFileStartsOverInsteadOfBeingSpliced() = runBlocking {
    start()
    val spec = spec("video.mkv")
    // A partial left by another version of the file (another size/time).
    spec.partFile.writeBytes(ByteArray(1000) { 7 })
    ResumeValidator.write(spec.partFile, "ftp 999 20200101000000")
    FtpTransfer(connector).transfer(spec)
    assertArrayEquals(File(home, "video.mkv").readBytes(), spec.partFile.readBytes())
    assertFalse("no offset for another file", commands.contains("REST"))
  }

  @Test fun explicitTlsIsUsedWhenTheServerOffersIt() = runBlocking {
    start(Tls.EXPLICIT)
    connector.withSession(FtpUrl.parse(url("video.mkv"))!!, null) { session -> assertTrue(session.tls) }
    assertTrue(commands.contains("AUTH"))
    assertTrue(commands.contains("PROT"))
    val spec = spec("video.mkv")
    FtpTransfer(connector).transfer(spec)
    assertArrayEquals(File(home, "video.mkv").readBytes(), spec.partFile.readBytes())
  }

  @Test fun plainFtpWhenTheServerHasNoTls() {
    start()
    connector.withSession(FtpUrl.parse(url("video.mkv"))!!, null) { session -> assertFalse(session.tls) }
  }

  @Test fun anFtpLinkToAServerWhoseCertificateDoesNotVerifyStaysPlain() {
    start(Tls.EXPLICIT)
    // The system trust store does not know the test certificate: an unverified TLS session is never used.
    val untrusting = FtpConnector(policy = FtpHostPolicy.ALLOW_ALL)
    untrusting.withSession(FtpUrl.parse(url("video.mkv"))!!, null) { session -> assertFalse(session.tls) }
  }

  @Test fun ftpsIsImplicitTlsThatMustVerify() = runBlocking {
    start(Tls.IMPLICIT)
    val spec = TransferSpec(url = url("video.mkv", scheme = "ftps"), context = context, partFile = File(tmp.root, "s.part"))
    FtpTransfer(connector).transfer(spec)
    assertArrayEquals(File(home, "video.mkv").readBytes(), spec.partFile.readBytes())

    // Never a fallback to plain FTP for an ftps:// link whose certificate does not verify.
    val untrusting = FtpProbe(FtpConnector(policy = FtpHostPolicy.ALLOW_ALL)).probe(url("video.mkv", scheme = "ftps"), context)
    assertEquals(ProbeFailure.NETWORK, (untrusting as ProbeResult.Failure).reason)
  }

  private companion object {
    val PASSWORD = "vidorax-test".toCharArray()

    /**
     * A throwaway self-signed certificate for `localhost` / 127.0.0.1, made by the JDK's own keytool once per run (no
     * keystore is ever committed: `*.p12` is ignored to keep signing keys out of the repository).
     */
    val KEYSTORE: File by lazy {
      val file = File(java.nio.file.Files.createTempDirectory("vidorax-ftp-tls").toFile(), "test-server.p12")
      val keytool = File(System.getProperty("java.home"), "bin/keytool")
      val process = ProcessBuilder(
        keytool.path, "-genkeypair", "-alias", "ftp", "-keyalg", "RSA", "-keysize", "2048", "-validity", "2",
        "-keystore", file.path, "-storetype", "PKCS12", "-storepass", String(PASSWORD), "-keypass", String(PASSWORD),
        "-dname", "CN=localhost", "-ext", "SAN=dns:localhost,ip:127.0.0.1",
      ).redirectErrorStream(true).start()
      val output = process.inputStream.bufferedReader().readText()
      check(process.waitFor() == 0 && file.isFile) { "keytool failed: $output" }
      file.deleteOnExit()
      file
    }
  }
}
