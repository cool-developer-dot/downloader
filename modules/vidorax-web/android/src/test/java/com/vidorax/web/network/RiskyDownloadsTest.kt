package com.vidorax.web.network

import org.junit.Assert.assertEquals
import org.junit.Assert.assertFalse
import org.junit.Assert.assertNull
import org.junit.Assert.assertTrue
import org.junit.Test

/**
 * H17 native routing: app and program files go through JavaScript (the Dangerous File Warning) before DownloadManager;
 * videos still go to detection and every other download still goes straight to DownloadManager.
 */
class RiskyDownloadsTest {
  private fun route(url: String, mimeType: String?, contentDisposition: String? = null) =
    WebDownloadRoute.of(url, mimeType, contentDisposition)

  @Test fun everyListedExtensionIsRiskyByTheUrl() {
    assertEquals(
      setOf("apk", "apks", "xapk", "exe", "msi", "bat", "cmd", "scr", "jar", "vbs", "sh", "dex"),
      RiskyDownloads.EXTENSIONS,
    )
    for (ext in RiskyDownloads.EXTENSIONS) {
      assertEquals(ext, WebDownloadRoute.Warn, route("https://files.example.com/dl/tool.$ext", "application/octet-stream"))
    }
  }

  @Test fun caseQueryAndEncodingDoNotHideTheExtension() {
    assertEquals(WebDownloadRoute.Warn, route("https://example.com/App.APK?token=abc#x", "application/octet-stream"))
    assertEquals(WebDownloadRoute.Warn, route("https://example.com/setup%2Eexe", "application/zip"))
    // With no MIME type this one is an unnamed binary: it goes to JavaScript as `unknown`, which warns as well.
    assertEquals(WebDownloadRoute.Detect(NetworkMediaHint.UNKNOWN), route("https://example.com/setup%2Eexe", null))
    assertEquals(WebDownloadRoute.Warn, route("https://example.com/a%20b/My%20Tool.msi", "application/octet-stream"))
  }

  @Test fun theContentDispositionNameCounts() {
    assertEquals(
      WebDownloadRoute.Warn,
      route("https://example.com/get.php?id=7", "application/octet-stream", "attachment; filename=\"update.apk\""),
    )
    assertEquals(
      WebDownloadRoute.Warn,
      route("https://example.com/file", "application/zip", "attachment; filename*=UTF-8''install%20me.bat"),
    )
    assertEquals(WebDownloadRoute.Warn, route("https://example.com/f", null, "attachment; filename=run.sh"))
  }

  @Test fun theMimeTypeCountsWhenTheNameSaysNothing() {
    assertEquals(WebDownloadRoute.Warn, route("https://example.com/f/9d1e", "application/vnd.android.package-archive"))
    assertEquals(WebDownloadRoute.Warn, route("https://example.com/f/9d1e", "application/x-msdownload; charset=binary"))
    assertEquals(WebDownloadRoute.Warn, route("https://example.com/f/9d1e", "APPLICATION/JAVA-ARCHIVE"))
  }

  @Test fun videosStillGoToDetectionExactlyAsBefore() {
    assertEquals(WebDownloadRoute.Detect(NetworkMediaHint.PROGRESSIVE), route("https://cdn.example.com/clip.mov", "video/quicktime"))
    assertEquals(
      WebDownloadRoute.Detect(NetworkMediaHint.MANIFEST_DASH),
      route("https://cdn.example.com/v/manifest.mpd", "application/dash+xml"),
    )
    assertEquals(WebDownloadRoute.Detect(NetworkMediaHint.UNKNOWN), route("https://cdn.example.com/m/o/5e1d0c", "application/octet-stream"))
    // A video by its MIME type is never risky, whatever it is named (as in the JavaScript rules).
    assertEquals(WebDownloadRoute.Detect(NetworkMediaHint.PROGRESSIVE), route("https://cdn.example.com/x.exe", "video/mp4"))
    assertFalse(RiskyDownloads.isRisky("https://cdn.example.com/seg.exe", "video/mp2t", null))
  }

  @Test fun everyOtherFileStillGoesStraightToDownloadManager() {
    assertEquals(WebDownloadRoute.System, route("https://example.com/report.pdf", "application/pdf"))
    assertEquals(WebDownloadRoute.System, route("https://example.com/photos.zip", "application/zip"))
    assertEquals(WebDownloadRoute.System, route("https://example.com/song.mp3", "audio/mpeg"))
    assertEquals(WebDownloadRoute.System, route("https://example.com/notes.txt", "application/octet-stream"))
    assertEquals(WebDownloadRoute.System, route("https://example.com/apk-guide.html", "text/html"))
    assertEquals("no extension after the dot", WebDownloadRoute.System, route("https://example.com/file.", "application/zip"))
    assertEquals("a dot file is not an extension", WebDownloadRoute.System, route("https://example.com/.sh", "application/zip"))
  }

  @Test fun fileNamesAreReadLikeTheJavaScriptRules() {
    assertEquals("tool.apk", RiskyDownloads.fileNameFromUrl("https://x.example/a/tool.apk?x=1"))
    assertNull(RiskyDownloads.fileNameFromUrl("https://x.example/"))
    assertEquals("a b.exe", RiskyDownloads.fileNameFromContentDisposition("attachment; filename*=UTF-8''a%20b.exe"))
    assertEquals("c.msi", RiskyDownloads.fileNameFromContentDisposition("attachment; filename=\"c.msi\""))
    assertNull(RiskyDownloads.fileNameFromContentDisposition("attachment; filename=\"\""))
    assertNull(RiskyDownloads.fileNameFromContentDisposition("inline"))
    assertEquals("sh", RiskyDownloads.extensionOf("archive.tar.SH"))
    assertNull(RiskyDownloads.extensionOf(".bashrc"))
    assertTrue(RiskyDownloads.isRisky("https://x.example/dl", null, "attachment; filename=\"a.pdf\"; filename*=UTF-8''a.apk"))
  }
}
