package com.vidorax.web.network

import org.junit.Assert.assertEquals
import org.junit.Assert.assertNull
import org.junit.Test

class NetworkMediaClassifierTest {
  private fun classify(
    url: String,
    accept: String? = "*/*",
    hasRange: Boolean = false,
    isMainFrame: Boolean = false,
    method: String = "GET",
  ) = NetworkMediaClassifier.classify(url, method, isMainFrame, accept, hasRange)

  @Test
  fun manifestsByExtensionAcceptOrEmbeddedUrl() {
    assertEquals(NetworkMediaHint.MANIFEST_HLS, classify("https://cdn.example.com/v/master.m3u8?token=abc"))
    assertEquals(NetworkMediaHint.MANIFEST_HLS, classify("https://cdn.example.com/playlist", accept = "application/vnd.apple.mpegurl"))
    assertEquals(NetworkMediaHint.MANIFEST_HLS, classify("https://proxy.example.com/load?src=https%3A%2F%2Fcdn%2Fmaster.m3u8"))
    assertEquals(NetworkMediaHint.MANIFEST_DASH, classify("https://cdn.example.com/stream/manifest.mpd"))
    assertEquals(NetworkMediaHint.MANIFEST_DASH, classify("https://cdn.example.com/dash", accept = "application/dash+xml"))
  }

  @Test
  fun progressiveFiles() {
    assertEquals(NetworkMediaHint.PROGRESSIVE, classify("https://video.example.com/clips/cat.MP4", hasRange = true))
    assertEquals(NetworkMediaHint.PROGRESSIVE, classify("https://example.com/audio/track.m4a"))
    assertEquals(NetworkMediaHint.PROGRESSIVE, classify("https://example.com/v/initial.mp4"))
    assertEquals(
      NetworkMediaHint.PROGRESSIVE,
      classify("https://v16-webapp.tiktok.com/video/tos/useast2a/abc/?mime_type=video_mp4&br=1200", hasRange = true),
    )
    assertEquals(
      NetworkMediaHint.PROGRESSIVE,
      classify("https://example.com/files/movie.mp4", accept = "text/html,application/xhtml+xml", isMainFrame = true),
    )
  }

  @Test
  fun byteRangeRequests() {
    assertEquals(
      NetworkMediaHint.RANGE_MEDIA,
      classify("https://scontent.cdninstagram.com/o1/v/t16/f2/m86/AQN.mp4?stp=dst&bytestart=0&byteend=1024"),
    )
    assertEquals(NetworkMediaHint.RANGE_MEDIA, classify("https://media.example.com/object/12345", hasRange = true))
  }

  @Test
  fun segmentsAndInitSegments() {
    listOf(
      "https://cdn.example.com/hls/720p/segment_00042.ts",
      "https://cdn.example.com/dash/chunk-stream0-00001.m4s",
      "https://cdn.example.com/hls/audio/segment3.aac",
      "https://cdn.example.com/dash/init.mp4",
      "https://cdn.example.com/dash/video_init-1080.mp4",
      "https://cdn.example.com/hls/seg-12-v1-a1.mp4",
    ).forEach { url -> assertEquals(url, NetworkMediaHint.SEGMENT, classify(url, hasRange = true)) }
  }

  @Test
  fun unknownWhenOnlyAcceptSuggestsMedia() {
    assertEquals(NetworkMediaHint.UNKNOWN, classify("https://api.example.com/media/42", accept = "video/*"))
  }

  @Test
  fun ignoresDocumentsStaticAssetsAndApiCalls() {
    assertNull(classify("https://www.example.com/watch/42", accept = "text/html,application/xhtml+xml", isMainFrame = true))
    assertNull(classify("https://www.example.com/watch/42", hasRange = true, isMainFrame = true))
    assertNull(classify("https://player.example.com/embed/42", accept = "text/html,application/xhtml+xml", hasRange = true))
    assertNull(classify("https://cdn.example.com/poster", accept = "image/avif,image/webp,*/*", hasRange = true))
    assertNull(classify("https://cdn.example.com/app.js"))
    assertNull(classify("https://cdn.example.com/styles.css?v=2", hasRange = true))
    assertNull(classify("https://cdn.example.com/font.woff2", hasRange = true))
    assertNull(classify("https://cdn.example.com/thumb.jpg?bytestart=0&byteend=99"))
    assertNull(classify("https://api.example.com/graphql", accept = "application/json"))
  }

  @Test
  fun ignoresYouTubeNonHttpAndNonGetRequests() {
    assertNull(classify("https://rr3---sn-abc.googlevideo.com/videoplayback?mime=video%2Fmp4", hasRange = true))
    assertNull(classify("https://www.youtube.com/s/player/master.m3u8"))
    assertNull(classify("https://youtu.be/clip.mp4"))
    assertEquals(NetworkMediaHint.PROGRESSIVE, classify("https://notyoutube.com/clip.mp4"))
    assertNull(classify("blob:https://example.com/7f0c"))
    assertNull(classify("data:video/mp4;base64,AAAA"))
    assertNull(classify("https://cdn.example.com/upload.mp4", method = "POST"))
  }

  @Test
  fun dedupeKeyDropsByteRangeParamsAndFragment() {
    assertEquals(
      "https://cdn.example.com/v.mp4?stp=dst&oh=sig",
      NetworkMediaClassifier.dedupeKey("https://cdn.example.com/v.mp4?stp=dst&bytestart=0&byteend=1024&oh=sig#t=3"),
    )
    assertEquals("https://cdn.example.com/v.mp4", NetworkMediaClassifier.dedupeKey("https://cdn.example.com/v.mp4?range=0-100&rn=2&RBUF=0"))
    assertEquals("https://cdn.example.com/v.mp4", NetworkMediaClassifier.dedupeKey("https://cdn.example.com/v.mp4"))
  }

  @Test
  fun rangeStartParsesTheFirstOffset() {
    assertEquals(0L, NetworkMediaClassifier.rangeStart("bytes=0-"))
    assertEquals(1048576L, NetworkMediaClassifier.rangeStart(" bytes=1048576-2097151"))
    assertEquals(100L, NetworkMediaClassifier.rangeStart("bytes=100-199,300-399"))
    assertNull(NetworkMediaClassifier.rangeStart("bytes=-500"))
    assertNull(NetworkMediaClassifier.rangeStart("items=0-5"))
    assertNull(NetworkMediaClassifier.rangeStart(null))
  }

  @Test
  fun urlPartsSplitHostFileAndQuery() {
    val parts = requireNotNull(UrlParts.parse("https://user@Media.Example.com:8443/a/b/Clip.Final.MP4?x=1#frag?y"))
    assertEquals("media.example.com", parts.host)
    assertEquals("Clip.Final", parts.fileStem)
    assertEquals("mp4", parts.extension)
    assertEquals("x=1", parts.query)

    val bare = requireNotNull(UrlParts.parse("http://example.com"))
    assertEquals("example.com", bare.host)
    assertNull(bare.extension)
    assertEquals("", bare.query)
  }
}
