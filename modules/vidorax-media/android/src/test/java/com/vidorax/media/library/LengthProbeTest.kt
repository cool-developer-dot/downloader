package com.vidorax.media.library

import com.vidorax.media.model.Container
import com.vidorax.media.model.LibraryItem
import com.vidorax.media.model.SiteId
import java.io.File
import java.nio.file.Files
import kotlinx.coroutines.runBlocking
import org.junit.After
import org.junit.Assert.assertEquals
import org.junit.Before
import org.junit.Test

class LengthProbeTest {
  private lateinit var dir: File
  private val opened = mutableListOf<String>()

  @Before
  fun setUp() {
    dir = Files.createTempDirectory("length-probe").toFile()
    opened.clear()
  }

  @After
  fun tearDown() {
    dir.deleteRecursively()
  }

  private fun item(id: String, durationMs: Long?, withFile: Boolean = true): LibraryItem {
    val file = File(dir, "$id.mp4").apply { if (withFile) writeBytes(ByteArray(16) { 1 }) }
    return LibraryItem(
      id = id,
      title = "Clip $id",
      site = SiteId.WEB,
      pageUrl = null,
      sourceUrl = null,
      file = file,
      mimeType = "video/mp4",
      container = Container.MP4,
      videoCodec = "video/avc",
      audioCodec = null,
      hasAudio = false,
      width = 640,
      height = 360,
      durationMs = durationMs,
      sizeBytes = 16,
      thumbnail = null,
      favorite = false,
      galleryUri = null,
      createdAt = 1,
      completedAt = 1,
    )
  }

  private fun probe(items: Map<String, LibraryItem>, measured: Map<String, Long?>) = LengthProbe(
    itemOf = { items[it] },
    readLengthMs = { file ->
      opened.add(file.name)
      measured[file.nameWithoutExtension]
    },
  )

  @Test
  fun keepsARecordedLengthAndMeasuresOnlyTheMissingOnes() = runBlocking {
    val items = mapOf("a" to item("a", 61_000), "b" to item("b", null), "c" to item("c", 0))
    val result = probe(items, mapOf("b" to 90_500L, "c" to 4_000L)).lengths(listOf("a", "b", "c"))
    assertEquals(listOf(ProbedLength("a", 61_000), ProbedLength("b", 90_500), ProbedLength("c", 4_000)), result)
    assertEquals(listOf("b.mp4", "c.mp4"), opened)
  }

  @Test
  fun unknownIdsMissingFilesAndUnreadableLengthsStayUnknown() = runBlocking {
    val items = mapOf("gone" to item("gone", null, withFile = false), "bad" to item("bad", null))
    val result = probe(items, mapOf("bad" to null)).lengths(listOf("device:9", "gone", "bad"))
    assertEquals(listOf(ProbedLength("device:9", null), ProbedLength("gone", null), ProbedLength("bad", null)), result)
    assertEquals(listOf("bad.mp4"), opened)
  }

  @Test
  fun aFailingReadIsJustUnknown() = runBlocking {
    val items = mapOf("x" to item("x", null))
    val failing = LengthProbe(itemOf = { items[it] }, readLengthMs = { throw IllegalStateException("broken file") })
    assertEquals(listOf(ProbedLength("x", null)), failing.lengths(listOf("x")))
  }

  @Test
  fun dropsBlankAndRepeatedIdsAndMeasuresAtMostTen() = runBlocking {
    val ids = (1..14).map { "v$it" }
    val items = ids.associateWith { item(it, null) }
    val result = probe(items, ids.associateWith { 1_000L }).lengths(listOf(" ", "v1", "v1") + ids)
    assertEquals(LengthProbe.MAX_IDS, result.size)
    assertEquals(ids.take(LengthProbe.MAX_IDS), result.map { it.id })
  }
}
