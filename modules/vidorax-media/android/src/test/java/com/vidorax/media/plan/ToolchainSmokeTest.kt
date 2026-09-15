package com.vidorax.media.plan

import android.net.Uri
import androidx.annotation.OptIn
import androidx.media3.common.util.UnstableApi
import androidx.media3.exoplayer.dash.manifest.DashManifestParser
import androidx.media3.exoplayer.hls.playlist.HlsMultivariantPlaylist
import androidx.media3.exoplayer.hls.playlist.HlsPlaylistParser
import org.junit.Assert.assertEquals
import org.junit.Test
import org.junit.runner.RunWith
import org.robolectric.RobolectricTestRunner

@OptIn(UnstableApi::class)
@RunWith(RobolectricTestRunner::class)
class ToolchainSmokeTest {
  @Test
  fun parsersRun() {
    val hls = HlsPlaylistParser().parse(
      Uri.parse("https://cdn.example.com/master.m3u8"),
      "#EXTM3U\n#EXT-X-STREAM-INF:BANDWIDTH=1000,RESOLUTION=640x360\nlow.m3u8\n".byteInputStream(),
    ) as HlsMultivariantPlaylist
    assertEquals("https://cdn.example.com/low.m3u8", hls.variants[0].url.toString())

    val dash = DashManifestParser().parse(
      Uri.parse("https://cdn.example.com/a/manifest.mpd"),
      """<MPD type="static" mediaPresentationDuration="PT10S"><Period><AdaptationSet mimeType="video/mp4">
        <Representation id="v1" bandwidth="1000" width="640" height="360" codecs="avc1.4d401e"><BaseURL>v.mp4</BaseURL>
        </Representation></AdaptationSet></Period></MPD>""".byteInputStream(),
    )
    assertEquals("https://cdn.example.com/a/v.mp4", dash.getPeriod(0).adaptationSets[0].representations[0].baseUrls[0].url)
  }
}
