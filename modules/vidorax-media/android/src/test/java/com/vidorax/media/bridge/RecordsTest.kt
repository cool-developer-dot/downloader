package com.vidorax.media.bridge

import com.vidorax.media.library.Titles
import com.vidorax.media.model.DownloadSettings
import com.vidorax.media.model.LegacyMetadata
import com.vidorax.media.model.LibraryQuery
import com.vidorax.media.model.LibrarySort
import com.vidorax.media.model.SiteId
import com.vidorax.media.model.SourceKind
import expo.modules.kotlin.exception.CodedException
import org.junit.Assert.assertEquals
import org.junit.Assert.assertNull
import org.junit.Assert.assertThrows
import org.junit.Assert.assertTrue
import org.junit.Test

class RecordsTest {
  @Test
  fun emptyLibraryQueryUsesTheDefaults() {
    assertEquals(LibraryQuery(), LibraryQueryRecord().toModel())
  }

  @Test
  fun libraryPagingIsClamped() {
    val query = LibraryQueryRecord(limit = 5_000, offset = -3).toModel()

    assertEquals(LibraryQuery.MAX_LIMIT, query.limit)
    assertEquals(0, query.offset)
    assertEquals(1, LibraryQueryRecord(limit = 0).toModel().limit)
  }

  @Test
  fun libraryQueryParsesUnions() {
    val query = LibraryQueryRecord(search = "  ", site = "tiktok", favoritesOnly = true, sort = "longest").toModel()

    assertEquals(
      LibraryQuery(search = null, site = SiteId.TIKTOK, favoritesOnly = true, sort = LibrarySort.LONGEST),
      query,
    )
  }

  @Test
  fun unknownUnionValuesAreInvalidRequests() {
    assertInvalid { LibraryQueryRecord(site = "youtube").toModel() }
    assertInvalid { LibraryQueryRecord(sort = "random").toModel() }
    assertInvalid { ProbeRequestRecord(url = "https://example.com/v", kind = "rtmp").toModel() }
  }

  @Test
  fun probeCarriesTheHlsVariantChoice() {
    val probe = ProbeRequestRecord(url = "https://cdn.example.com/m.m3u8", kind = "hls", variant = VariantChoiceRecord(maxHeight = 480))

    assertEquals(480, probe.toModel().variant?.maxHeight)
    assertNull(probe.copy(variant = null).toModel().variant)
    assertInvalid { probe.copy(variant = VariantChoiceRecord(maxHeight = -1)).toModel() }
  }

  @Test
  fun enqueueRejectsMalformedSources() {
    val valid = EnqueueRequestRecord(url = "https://cdn.example.com/v.mp4", kind = "progressive", title = "Clip", site = "web")
    assertEquals(SourceKind.PROGRESSIVE, valid.toModel().kind)

    assertInvalid { valid.copy(url = "").toModel() }
    assertInvalid { valid.copy(url = "ftp://example.com/v.mp4").toModel() }
    assertInvalid { valid.copy(site = "").toModel() }
    assertInvalid { valid.copy(manifestText = "<MPD/>").toModel() }
    assertInvalid { valid.copy(kind = "hls", audioUrl = "https://cdn.example.com/a.m4a").toModel() }
    assertInvalid { valid.copy(audioUrl = "not a url").toModel() }
    assertInvalid { valid.copy(variant = VariantChoiceRecord(maxHeight = 0)).toModel() }
  }

  @Test
  fun aSplitDownloadCarriesItsAudioFileAndNeedsOne() {
    val split = EnqueueRequestRecord(
      url = "https://cdn.example.com/v.mp4",
      kind = "split",
      audioUrl = "https://cdn.example.com/a.m4a",
      title = "Reel",
      site = "instagram",
    ).toModel()
    assertEquals(SourceKind.SPLIT, split.kind)
    assertEquals("https://cdn.example.com/a.m4a", split.audioUrl)
    assertInvalid { EnqueueRequestRecord(url = "https://cdn.example.com/v.mp4", kind = "split", title = "Reel", site = "web").toModel() }
    assertInvalid { EnqueueRequestRecord(url = "https://cdn.example.com/v.mp4", kind = "split", audioUrl = "not a url", title = "R", site = "web").toModel() }
    val probe = ProbeRequestRecord(url = "https://cdn.example.com/v.mp4", kind = "split", audioUrl = "https://cdn.example.com/a.m4a").toModel()
    assertEquals("https://cdn.example.com/a.m4a", probe.audioUrl)
    assertInvalid { ProbeRequestRecord(url = "https://cdn.example.com/v.mp4", kind = "split").toModel() }
    assertInvalid { ProbeRequestRecord(url = "https://cdn.example.com/v.mp4", kind = "hls", audioUrl = "https://cdn.example.com/a.m4a").toModel() }
  }

  @Test
  fun enqueueNormalizesOptionalValues() {
    val request = EnqueueRequestRecord(
      url = " https://cdn.example.com/m.mpd ",
      kind = "dash",
      manifestText = "<MPD/>",
      title = " \n",
      site = "reddit",
      pageUrl = " ",
      durationMs = 12_345.6,
      estimatedBytes = -1.0,
      qualityLabel = " 720p ",
    ).toModel()

    assertEquals("https://cdn.example.com/m.mpd", request.url)
    assertEquals(Titles.FALLBACK, request.title)
    assertEquals(SiteId.REDDIT, request.site)
    assertNull(request.pageUrl)
    assertEquals(12_345L, request.durationMs)
    assertNull(request.estimatedBytes)
    assertEquals("720p", request.qualityLabel)
    assertNull(request.saveToGallery)
  }

  @Test
  fun requestContextNeverCarriesCookies() {
    val context = RequestContextRecord(
      userAgent = "UA",
      referer = "",
      headers = mapOf("cookie" to "a=b", "X-Test" to "1"),
      useCookies = true,
    ).toModel()

    assertEquals(mapOf("X-Test" to "1"), context.headers)
    assertEquals("UA", context.userAgent)
    assertNull(context.referer)
    assertTrue(context.useCookies)
  }

  @Test
  fun downloadSettingsAreRangeChecked() {
    assertEquals(DownloadSettings.DEFAULT, DownloadSettingsRecord().toModel())
    assertInvalid { DownloadSettingsRecord(maxConcurrent = 5).toModel() }
    assertInvalid { DownloadSettingsRecord(maxConcurrent = 0).toModel() }
    assertInvalid { DownloadSettingsRecord(preferredMaxHeight = -1).toModel() }
  }

  @Test
  fun legacyMetadataNeedsAnIdAndLeavesBlankFieldsUnchanged() {
    assertInvalid { LegacyMetadataRecord().toModel() }
    assertEquals(
      LegacyMetadata(id = "id1", title = null, site = SiteId.INSTAGRAM, pageUrl = null, favorite = true),
      LegacyMetadataRecord(id = "id1", title = " ", site = "instagram", favorite = true).toModel(),
    )
  }

  private fun assertInvalid(block: () -> Unit) {
    val error = assertThrows(CodedException::class.java) { block() }
    assertEquals("ERR_INVALID_REQUEST", error.code)
  }
}
