package com.vidorax.media.library

import android.net.Uri
import androidx.media3.common.C
import androidx.media3.effect.FrameDropEffect
import androidx.media3.effect.Presentation
import com.vidorax.media.model.Container
import com.vidorax.media.model.LibraryItem
import com.vidorax.media.model.SiteId
import expo.modules.kotlin.exception.CodedException
import java.io.File
import org.junit.Assert.assertEquals
import org.junit.Assert.assertFalse
import org.junit.Assert.assertNull
import org.junit.Assert.assertThrows
import org.junit.Assert.assertTrue
import org.junit.Test
import org.junit.runner.RunWith
import org.robolectric.RobolectricTestRunner

/**
 * P12 Merge videos (#682): the request (2–10 videos, each once), the output's size (the first video's, even numbers),
 * fitting every video inside it (the same numbers as src/media-edit/merge-plan.test.ts), the frame-rate rule, the sound
 * rule, and the one Transformer sequence it builds.
 */
@RunWith(RobolectricTestRunner::class)
class MergePlanTest {
  private fun item(id: String, sizeBytes: Long = 100_000_000) = LibraryItem(
    id = id, title = id, site = SiteId.WEB, pageUrl = null, sourceUrl = null, file = File("/data/library/web/$id.mp4"),
    mimeType = "video/mp4", container = Container.MP4, videoCodec = "video/avc", audioCodec = "audio/mp4a-latm",
    hasAudio = true, width = 1920, height = 1080, durationMs = 60_000, sizeBytes = sizeBytes, thumbnail = null,
    favorite = false, galleryUri = null, createdAt = 1, completedAt = 1,
  )

  private fun part(
    id: String,
    width: Int = 1920,
    height: Int = 1080,
    frameRate: Float? = 30f,
    hasAudio: Boolean = true,
    durationMs: Long = 60_000,
  ) = MergePart(item(id), EditSourceInfo(durationMs, width, height, frameRate, hasAudio))

  private fun record(sourceIds: List<String>?, video: String = "h264", sourceId: String = "a") = EditRequestRecord(
    sourceId = sourceId,
    kind = "merge",
    video = video,
    audio = "aac",
    title = "a (merged)",
    sourceIds = sourceIds,
  )

  @Test
  fun aMergeJoinsTwoToTenVideosEachOnceAndStartsFromOneOfThem() {
    val request = record(listOf("b", "a", "c")).toModel()
    assertEquals(EditKind.MERGE, request.kind)
    assertEquals(MergeSettings(listOf("b", "a", "c")), request.merge)
    assertThrows(CodedException::class.java) { record(null).toModel() }
    assertThrows(CodedException::class.java) { record(listOf("a")).toModel() }
    assertThrows(CodedException::class.java) { record(List(11) { "v$it" } + "a").toModel() }
    assertThrows(CodedException::class.java) { record(listOf("a", "b", "a")).toModel() }
    assertThrows(CodedException::class.java) { record(listOf("a", " ")).toModel() }
    assertThrows(CodedException::class.java) { record(listOf("b", "c")).toModel() }
    // A merge always re-encodes the video.
    assertThrows(CodedException::class.java) { record(listOf("a", "b"), video = "copy").toModel() }
    assertTrue(MediaEditor.kinds().containsAll(listOf("merge", "speed")))
  }

  @Test
  fun theOutputTakesTheFirstVideosSizeInEvenNumbers() {
    assertEquals(1920 to 1080, MergePlan.evenSize(1920, 1080))
    assertEquals(852 to 480, MergePlan.evenSize(853, 480))
    assertEquals(2 to 2, MergePlan.evenSize(1, 1))
    val layout = MergePlan.layout(listOf(part("a", 1080, 1920), part("b"), part("c", 853, 481)))
    assertEquals(1080 to 1920, layout.width to layout.height)
    assertEquals(180_000L, layout.totalMs)
  }

  @Test
  fun everyVideoIsFittedInsideKeepingItsAspect() {
    assertEquals(1920 to 1080, MergePlan.fitInside(1920, 1080, 1280, 720))
    // Portrait in landscape: bars at the sides.
    assertEquals(608 to 1080, MergePlan.fitInside(1920, 1080, 1080, 1920))
    // 4:3 in 16:9.
    assertEquals(1440 to 1080, MergePlan.fitInside(1920, 1080, 640, 480))
    // Landscape in portrait: bars above and below.
    assertEquals(1080 to 608, MergePlan.fitInside(1080, 1920, 1920, 1080))
    // What Presentation does with it: every video comes out at the output's size.
    val layout = MergePlan.layout(listOf(part("a"), part("b", 1080, 1920)))
    val presentation = MergePlan.videoEffects(layout, layout.parts[1]).last() as Presentation
    val size = presentation.configure(1080, 1920)
    assertEquals(1920 to 1080, size.width to size.height)
  }

  @Test
  fun aFasterClipIsDroppedToTheFirstVideosFrameRateASlowerOneKeepsItsFrames() {
    assertEquals(30f, MergePlan.frameRateCap(30f, 60f))
    assertEquals(24f, MergePlan.frameRateCap(24f, 30f))
    assertNull(MergePlan.frameRateCap(30f, 29.97f))
    assertNull(MergePlan.frameRateCap(30f, 30.4f))
    assertNull(MergePlan.frameRateCap(60f, 30f))
    assertNull(MergePlan.frameRateCap(null, 60f))
    assertNull(MergePlan.frameRateCap(30f, null))
    val layout = MergePlan.layout(listOf(part("a", frameRate = 30f), part("b", frameRate = 60f), part("c", frameRate = 24f)))
    assertTrue(MergePlan.videoEffects(layout, layout.parts[1]).first() is FrameDropEffect)
    assertEquals(1, MergePlan.videoEffects(layout, layout.parts[0]).size)
    assertEquals(1, MergePlan.videoEffects(layout, layout.parts[2]).size)
  }

  @Test
  fun withSoundAnywhereTheSequenceHasASoundTrackSilentForVideosWithout() {
    val mixed = MergePlan.layout(listOf(part("a", hasAudio = false), part("b", hasAudio = true)))
    assertTrue(mixed.hasAudio)
    val composition = MergePlan.composition(mixed, keepAudio = true)
    assertEquals(1, composition.sequences.size)
    val sequence = composition.sequences.single()
    assertEquals(2, sequence.editedMediaItems.size)
    assertTrue(sequence.forceAudioTrack)
    assertEquals(setOf(C.TRACK_TYPE_AUDIO, C.TRACK_TYPE_VIDEO), sequence.trackTypes)
    assertFalse(sequence.editedMediaItems.any { it.removeAudio })
    // In order.
    assertEquals(mixed.parts.map { Uri.fromFile(it.item.file) }, sequence.editedMediaItems.map { it.mediaItem.localConfiguration!!.uri })

    val silent = MergePlan.layout(listOf(part("a", hasAudio = false), part("b", hasAudio = false)))
    assertFalse(silent.hasAudio)
    val video = MergePlan.composition(silent, keepAudio = false).sequences.single()
    assertFalse(video.forceAudioTrack)
    assertEquals(setOf(C.TRACK_TYPE_VIDEO), video.trackTypes)
    assertTrue(video.editedMediaItems.all { it.removeAudio })
  }

  @Test
  fun theSpaceNeededIsEveryVideoReencodedTheSameAsJavaScript() {
    val layout = MergePlan.layout(listOf(part("a"), part("b"), part("c")))
    // 3 × 100 MB × 2.
    assertEquals(600_000_000L, MergePlan.estimateBytes(layout))
  }
}
