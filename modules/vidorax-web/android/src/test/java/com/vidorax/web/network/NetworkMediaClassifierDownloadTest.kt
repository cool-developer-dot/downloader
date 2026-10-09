package com.vidorax.web.network

import org.junit.Assert.assertEquals
import org.junit.Assert.assertNull
import org.junit.Test

class NetworkMediaClassifierDownloadTest {
  private fun classify(url: String, mimeType: String?, contentDisposition: String? = null) =
    NetworkMediaClassifier.classifyDownload(url, mimeType, contentDisposition)

  @Test
  fun manifestsThatTheWebViewCannotRenderAreClaimed() {
    assertEquals(NetworkMediaHint.MANIFEST_DASH, classify("https://cdn.example.com/v/manifest.mpd", "application/dash+xml"))
    assertEquals(NetworkMediaHint.MANIFEST_HLS, classify("https://cdn.example.com/v/master", "application/vnd.apple.mpegurl"))
    assertEquals(NetworkMediaHint.MANIFEST_HLS, classify("https://cdn.example.com/v/master", "application/x-mpegURL; charset=utf-8"))
    assertEquals(NetworkMediaHint.MANIFEST_DASH, classify("https://cdn.example.com/v/stream.mpd", "application/octet-stream"))
  }

  @Test
  fun videoFilesByTypeOrName() {
    assertEquals(NetworkMediaHint.PROGRESSIVE, classify("https://cdn.example.com/clip.mov", "video/quicktime"))
    assertEquals(NetworkMediaHint.PROGRESSIVE, classify("https://cdn.example.com/dl?id=4", "video/mp4", "attachment; filename=\"a.mp4\""))
    assertEquals(NetworkMediaHint.PROGRESSIVE, classify("https://cdn.example.com/files/movie.MKV", "application/octet-stream"))
    assertEquals(
      NetworkMediaHint.PROGRESSIVE,
      classify("https://drive.example.com/uc?export=download&id=9", "application/octet-stream", "attachment; filename*=UTF-8''holiday%20clip.mp4"),
    )
    assertEquals(NetworkMediaHint.PROGRESSIVE, classify("https://cdn.example.com/get.php?f=9", null, "attachment; filename=trip.webm"))
  }

  @Test
  fun unnamedBinariesAreAskedAbout() {
    assertEquals(NetworkMediaHint.UNKNOWN, classify("https://cdn.example.com/m/o/5e1d0c", "application/octet-stream"))
    assertEquals(NetworkMediaHint.UNKNOWN, classify("https://cdn.example.com/download.php?id=3", "application/force-download"))
    assertEquals(NetworkMediaHint.UNKNOWN, classify("https://cdn.example.com/blob", null))
  }

  @Test
  fun everythingElseStaysWithTheSystemDownloader() {
    assertNull(classify("https://example.com/report.pdf", "application/pdf"))
    assertNull(classify("https://example.com/app.apk", "application/vnd.android.package-archive"))
    assertNull(classify("https://example.com/files/pack.zip", "application/octet-stream"))
    assertNull(classify("https://example.com/song.mp3", "audio/mpeg"))
    assertNull(classify("https://example.com/seg12.ts", "video/mp2t"))
    assertNull(classify("https://example.com/dl", "application/octet-stream", "attachment; filename=\"notes.txt\""))
    assertNull(classify("https://rr3---sn.googlevideo.com/videoplayback?id=1", "video/mp4"))
    assertNull(classify("ftp://example.com/clip.mp4", "video/mp4"))
  }
}
