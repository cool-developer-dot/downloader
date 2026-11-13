package com.vidorax.media.subtitles

import android.net.Uri
import androidx.annotation.OptIn
import androidx.media3.common.util.UnstableApi
import androidx.media3.exoplayer.dash.manifest.DashManifestParser
import org.junit.Assert.assertEquals
import org.junit.Test
import org.junit.runner.RunWith
import org.robolectric.RobolectricTestRunner

/** H19: a DASH text set's `<Role>` marks its track default ("main") or forced ("forced-subtitle"). */
@OptIn(UnstableApi::class)
@RunWith(RobolectricTestRunner::class)
class SubtitleTracksTest {
  private fun textSet(id: Int, lang: String, role: String) = """
    <AdaptationSet id="$id" contentType="text" mimeType="text/vtt" lang="$lang">
      <Role schemeIdUri="urn:mpeg:dash:role:2011" value="$role"/>
      <Representation id="sub-$lang" bandwidth="1000"><BaseURL>subs/$lang.vtt</BaseURL></Representation>
    </AdaptationSet>
  """

  @Test fun dashRolesMarkTheDefaultAndForcedTracks() {
    val manifest = DashManifestParser().parse(
      Uri.parse("https://cdn.example.com/dash/manifest.mpd"),
      """<MPD type="static" mediaPresentationDuration="PT30S"><Period>
        ${textSet(1, "en", "main")}${textSet(2, "fr", "forced-subtitle")}${textSet(3, "de", "subtitle")}
      </Period></MPD>""".byteInputStream(),
    )
    val tracks = SubtitleTracks.fromDash(manifest)

    assertEquals(listOf("en", "fr", "de"), tracks.map { it.language })
    assertEquals(listOf(true, false, false), tracks.map { it.isDefault })
    assertEquals(listOf(false, true, false), tracks.map { it.isForced })
  }
}
