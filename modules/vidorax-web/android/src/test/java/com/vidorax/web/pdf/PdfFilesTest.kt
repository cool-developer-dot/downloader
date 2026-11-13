package com.vidorax.web.pdf

import android.webkit.CookieManager
import org.junit.Assert.assertEquals
import org.junit.Assert.assertFalse
import org.junit.Assert.assertTrue
import org.junit.Rule
import org.junit.Test
import org.junit.rules.TemporaryFolder
import org.junit.runner.RunWith
import org.robolectric.RobolectricTestRunner
import java.io.ByteArrayInputStream
import java.io.File
import java.io.InputStream
import java.net.HttpURLConnection
import java.net.URL

@RunWith(RobolectricTestRunner::class)
class PdfFilesTest {
  @get:Rule val folder = TemporaryFolder()

  @Test
  fun recognisesPdfsByTypeOrName() {
    assertTrue(PdfFiles.isPdf("https://x.test/a", "application/pdf", null))
    assertTrue(PdfFiles.isPdf("https://x.test/a", "application/pdf; charset=binary", null))
    assertTrue(PdfFiles.isPdf("https://x.test/report.PDF?dl=1", "application/octet-stream", null))
    assertTrue(PdfFiles.isPdf("https://x.test/get", null, "attachment; filename=\"r.pdf\""))
    assertFalse(PdfFiles.isPdf("https://x.test/report.pdf", "video/mp4", null))
    assertFalse(PdfFiles.isPdf("https://x.test/a.zip", "application/zip", null))
  }

  @Test
  fun pagesAreCappedAndCacheFilesStayInTheirFolder() {
    assertEquals(1200 to 1552, PdfDocuments.renderSize(612, 792, 1200))
    assertEquals(PdfDocuments.MAX_WIDTH, PdfDocuments.renderSize(612, 792, 9000).first)
    assertEquals(PdfDocuments.MAX_HEIGHT, PdfDocuments.renderSize(100, 2000, 1000).second)
    val cache = folder.root
    assertTrue(PdfFiles.isInCache(cache, PdfFiles.cacheFile(cache, "https://x.test/a.pdf")))
    assertFalse(PdfFiles.isInCache(cache, File(cache, "pdf/../other.pdf")))
    assertFalse(PdfFiles.isInCache(cache, File(cache, "pdf/a.txt")))
  }

  private class FakeConnection(url: URL, private val code: Int, private val headers: Map<String, String>, private val body: ByteArray) :
    HttpURLConnection(url) {
    val sent = mutableMapOf<String, String>()
    override fun setRequestProperty(key: String, value: String) {
      sent[key] = value
    }
    override fun getResponseCode() = code
    override fun getHeaderField(name: String): String? = headers[name]
    override fun getContentLengthLong() = body.size.toLong()
    override fun getInputStream(): InputStream = ByteArrayInputStream(body)
    override fun connect() = Unit
    override fun disconnect() = Unit
    override fun usingProxy() = false
  }

  @Test
  fun fetchFollowsRedirectsWithEachHostsOwnCookiesAndChecksTheFile() {
    val jar = CookieManager.getInstance()
    jar.setCookie("https://a.test/", "sid=A")
    val made = mutableListOf<FakeConnection>()
    val pdf = "%PDF-1.7 body".toByteArray()
    val target = File(folder.root, "pdf/x.pdf")
    val result = PdfFiles.fetch("https://a.test/doc", "UA", jar, target) { url ->
      (if (url.host == "a.test") FakeConnection(url, 302, mapOf("Location" to "https://b.test/file.pdf"), ByteArray(0)) else FakeConnection(url, 200, emptyMap(), pdf))
        .also { made += it }
    }
    assertTrue(result is PdfFiles.Fetch.Done)
    assertEquals("sid=A", made[0].sent["Cookie"])
    assertFalse("the other host never gets a.test's cookie", made[1].sent.containsKey("Cookie"))
    assertEquals("%PDF-1.7 body", target.readText())

    val html = PdfFiles.fetch("https://b.test/x", null, null, File(folder.root, "pdf/y.pdf")) { FakeConnection(it, 200, emptyMap(), "<html>".toByteArray()) }
    assertEquals(PdfFiles.Fetch.Failed("notPdf"), html)
    assertEquals(PdfFiles.Fetch.Failed("unsafe"), PdfFiles.fetch("file:///sdcard/a.pdf", null, null, target))
  }
}
