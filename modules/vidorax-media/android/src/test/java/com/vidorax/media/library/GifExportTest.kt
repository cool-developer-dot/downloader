package com.vidorax.media.library

import android.graphics.BitmapFactory
import expo.modules.kotlin.exception.CodedException
import java.io.ByteArrayOutputStream
import java.io.File
import org.junit.Assert.assertEquals
import org.junit.Assert.assertFalse
import org.junit.Assert.assertNotNull
import org.junit.Assert.assertThrows
import org.junit.Assert.assertTrue
import org.junit.Rule
import org.junit.Test
import org.junit.rules.TemporaryFolder
import org.junit.runner.RunWith
import org.robolectric.RobolectricTestRunner
import org.robolectric.annotation.GraphicsMode

/**
 * P12 Create GIF (#676): the request JavaScript sends, the range (1–15 s, inside the video), the size (never wider than
 * the video), the frame count and size estimate (the same numbers as src/media-edit/gif-plan.test.ts), the share copy,
 * and Android's own decoder (Skia, through BitmapFactory) reading the encoder's output.
 */
@RunWith(RobolectricTestRunner::class)
@GraphicsMode(GraphicsMode.Mode.NATIVE)
class GifExportTest {
  @get:Rule val folder = TemporaryFolder()

  private fun record(
    startMs: Double? = 2_000.0,
    endMs: Double? = 7_000.0,
    width: Double? = 480.0,
    fps: Double? = 10.0,
  ) = GifRequestRecord(sourceId = "lib1", startMs = startMs, endMs = endMs, width = width, fps = fps, title = "Beach 0m02.0s")

  private fun info(width: Int = 1920, height: Int = 1080, durationMs: Long = 60_000) =
    EditSourceInfo(durationMs = durationMs, width = width, height = height, frameRate = 30f, hasAudio = true)

  @Test
  fun aValidRequestBecomesAGifRequest() {
    val request = record().toModel()
    assertEquals(GifRequest("lib1", 2_000, 7_000, 480, 10, "Beach 0m02.0s"), request)
  }

  @Test
  fun theRequestIsCheckedBeforeAnythingRuns() {
    assertThrows(CodedException::class.java) { GifRequestRecord(startMs = 0.0, endMs = 5_000.0, width = 480.0, fps = 10.0).toModel() }
    assertThrows(CodedException::class.java) { record(startMs = null).toModel() }
    assertThrows(CodedException::class.java) { record(endMs = Double.NaN).toModel() }
    // Longer than 15 s, shorter than 1 s.
    assertThrows(CodedException::class.java) { record(startMs = 0.0, endMs = 15_001.0).toModel() }
    assertThrows(CodedException::class.java) { record(startMs = 0.0, endMs = 999.0).toModel() }
    assertThrows(CodedException::class.java) { record(width = 8.0).toModel() }
    assertThrows(CodedException::class.java) { record(width = 640.0).toModel() }
    assertThrows(CodedException::class.java) { record(fps = 0.0).toModel() }
    assertThrows(CodedException::class.java) { record(fps = 30.0).toModel() }
    assertEquals(15_000L, record(startMs = 0.0, endMs = 15_000.0).toModel().endMs)
  }

  @Test
  fun theRangeStaysInsideTheVideoAndIsOneToFifteenSeconds() {
    assertEquals(2_000L to 7_000L, GifPlan.clampRange(2_000, 7_000, 60_000))
    // Near the end the start moves back, so the length chosen is kept.
    assertEquals(55_000L to 60_000L, GifPlan.clampRange(58_000, 63_000, 60_000))
    assertEquals(0L to 15_000L, GifPlan.clampRange(0, 20_000, 60_000))
    assertEquals(500L to 1_500L, GifPlan.clampRange(500, 600, 60_000))
    // A video shorter than the part asked: all of it.
    assertEquals(0L to 3_000L, GifPlan.clampRange(0, 5_000, 3_000))
    assertThrows(CodedException::class.java) { GifPlan.clampRange(0, 1_000, 800) }
  }

  @Test
  fun theSizeIsNeverWiderThanTheVideoAndKeepsItsAspect() {
    assertEquals(480 to 270, GifPlan.outputSize(1920, 1080, 480))
    assertEquals(320 to 180, GifPlan.outputSize(1920, 1080, 320))
    assertEquals(320 to 180, GifPlan.outputSize(1280, 720, 320))
    // Portrait: the width is the preset, the height follows.
    assertEquals(480 to 853, GifPlan.outputSize(1080, 1920, 480))
    // A small video keeps its own width.
    assertEquals(300 to 200, GifPlan.outputSize(300, 200, 480))
    assertEquals(GifFramePlan(2_000, 7_000, 480, 270, 10, 50), GifExport.plan(info(), record().toModel()))
  }

  @Test
  fun framesAndTheSizeEstimateAreTheSameMathsAsJavaScript() {
    assertEquals(50, GifPlan.frameCount(5_000, 10))
    assertEquals(225, GifPlan.frameCount(15_000, 15))
    assertEquals(30, GifPlan.frameCount(2_950, 10))
    assertEquals(15, GifPlan.frameCount(1_000, 15))
    assertEquals(2_000_000L, GifPlan.frameTimeUs(2_000, 0, 15))
    assertEquals(2_066_666L, GifPlan.frameTimeUs(2_000, 1, 15))
    assertEquals(16_933_333L, GifPlan.frameTimeUs(2_000, 224, 15))
    // 5 s at 10 fps, 480 × 270: 33 + 50 × (788 + 77 760 + 305) bytes typical, 33 + 50 × (788 + 194 400 + 763) at most.
    assertEquals(3_942_683L, GifPlan.estimateBytes(50, 480, 270))
    assertEquals(9_797_583L, GifPlan.maxBytes(50, 480, 270))
    assertEquals(19_595_166L, GifPlan.spaceNeeded(GifFramePlan(0, 5_000, 480, 270, 10, 50)))
    assertEquals(0L, GifPlan.estimateBytes(0, 480, 270))
  }

  @Test
  fun androidsOwnDecoderReadsTheEncodersOutput() {
    val out = ByteArrayOutputStream()
    val encoder = GifEncoder(out, 40, 30)
    val green = 0xFF00C000.toInt()
    val magenta = 0xFFC000C0.toInt()
    encoder.addFrame(IntArray(40 * 30) { i -> if ((i % 40) < 20) green else magenta }, 10)
    encoder.addFrame(IntArray(40 * 30) { magenta }, 10)
    encoder.finish()
    val bitmap = BitmapFactory.decodeByteArray(out.toByteArray(), 0, out.size())
    assertNotNull("BitmapFactory decodes the GIF", bitmap)
    assertEquals(40, bitmap.width)
    assertEquals(30, bitmap.height)
    assertEquals(green, bitmap.getPixel(5, 5))
    assertEquals(magenta, bitmap.getPixel(35, 25))
  }

  @Test
  fun onlyTheLatestShareCopyIsKeptAndANameCantReachOutside() {
    val paths = StoragePaths(folder.newFolder("files"), folder.newFolder("no_backup"))
    val first = File(folder.root, "one.gif").apply { writeBytes(byteArrayOf(1, 2, 3)) }
    val kept = GifExport.keepShareCopy(paths, first, "Beach 0m02.0s")
    assertEquals(File(paths.libraryDir, ".gif-exports"), kept.parentFile)
    assertEquals("Beach 0m02.0s.gif", kept.name)
    assertFalse(first.exists())
    val second = File(folder.root, "two.gif").apply { writeBytes(byteArrayOf(4, 5)) }
    val latest = GifExport.keepShareCopy(paths, second, "Hills 1m00.0s")
    assertFalse(kept.exists())
    assertEquals(latest, GifExport.shareFile(paths, "Hills 1m00.0s.gif"))
    for (name in listOf("Beach 0m02.0s.gif", "../Hills 1m00.0s.gif", "x/Hills 1m00.0s.gif", "Hills 1m00.0s.jpg", ".gif", "")) {
      assertThrows(name, CodedException::class.java) { GifExport.shareFile(paths, name) }
    }
    assertTrue(latest.isFile)
  }
}
