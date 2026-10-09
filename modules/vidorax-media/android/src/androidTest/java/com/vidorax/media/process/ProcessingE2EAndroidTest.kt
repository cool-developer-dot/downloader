package com.vidorax.media.process

import android.content.Context
import android.net.Uri
import androidx.media3.common.C
import androidx.media3.common.MediaItem
import androidx.media3.common.PlaybackException
import androidx.media3.common.Player
import androidx.media3.exoplayer.ExoPlayer
import androidx.test.ext.junit.runners.AndroidJUnit4
import androidx.test.platform.app.InstrumentationRegistry
import com.vidorax.media.model.Container
import java.io.File
import kotlinx.coroutines.runBlocking
import org.junit.After
import org.junit.Assert.assertEquals
import org.junit.Assert.assertNotNull
import org.junit.Assert.assertTrue
import org.junit.Before
import org.junit.Test
import org.junit.runner.RunWith

/**
 * The media-processing layer on a real device: Media3's muxers for lossless remux/merge and Media3 Transformer over
 * the platform MediaCodec encoders for the tracks an MP4 cannot carry — every output then opened with Media3
 * ExoPlayer (the player expo-video runs) to prove it plays, has both tracks, the source's length, and seeks.
 */
@RunWith(AndroidJUnit4::class)
class ProcessingE2EAndroidTest {
  private val context: Context get() = InstrumentationRegistry.getInstrumentation().targetContext
  private lateinit var work: File
  private lateinit var processor: MediaProcessor

  @Before fun setUp() {
    work = File(context.cacheDir, "processing-e2e").apply { deleteRecursively(); mkdirs() }
    processor = MediaProcessor(Remuxer(), TransformerTranscoder(context), AndroidCodecSupport)
  }

  @After fun tearDown() {
    work.deleteRecursively()
  }

  private fun fixture(name: String): File {
    val bytes = checkNotNull(javaClass.getResourceAsStream("/process/$name")) { "missing $name" }.use { it.readBytes() }
    return File(work, "in-$name").apply { writeBytes(bytes) }
  }

  private fun process(input: ProcessingInput): ProcessingResult.Done = runBlocking {
    when (val result = processor.process(input, work)) {
      is ProcessingResult.Done -> result
      is ProcessingResult.Failed -> throw AssertionError("processing failed: ${result.code} ${result.message}")
    }
  }

  private data class Playback(
    val durationMs: Long,
    val videoMime: String?,
    val audioMime: String?,
    val seekable: Boolean,
    val positionAfterSeekMs: Long,
  )

  /** Opens the file with ExoPlayer, reads its tracks, seeks to the middle. */
  private fun play(file: File): Playback {
    val instrumentation = InstrumentationRegistry.getInstrumentation()
    lateinit var player: ExoPlayer
    var error: PlaybackException? = null
    instrumentation.runOnMainSync {
      player = ExoPlayer.Builder(context).build()
      player.addListener(object : Player.Listener {
        override fun onPlayerError(e: PlaybackException) { error = e }
      })
      player.setMediaItem(MediaItem.fromUri(Uri.fromFile(file)))
      player.prepare()
    }
    try {
      waitMain(15_000) { error != null || player.playbackState == Player.STATE_READY }
      error?.let { throw AssertionError("ExoPlayer could not play ${file.name}: ${it.errorCodeName}", it) }
      var duration = 0L
      var seekable = false
      var video: String? = null
      var audio: String? = null
      instrumentation.runOnMainSync {
        duration = player.duration
        seekable = player.isCurrentMediaItemSeekable
        video = player.currentTracks.groups.firstOrNull { it.type == C.TRACK_TYPE_VIDEO }?.getTrackFormat(0)?.sampleMimeType
        audio = player.currentTracks.groups.firstOrNull { it.type == C.TRACK_TYPE_AUDIO }?.getTrackFormat(0)?.sampleMimeType
        player.seekTo(duration / 2)
      }
      waitMain(15_000) { error != null || player.playbackState == Player.STATE_READY && !player.isLoading }
      var position = 0L
      instrumentation.runOnMainSync { position = player.currentPosition }
      return Playback(duration, video, audio, seekable, position)
    } finally {
      instrumentation.runOnMainSync { player.release() }
    }
  }

  private fun waitMain(timeoutMs: Long, condition: () -> Boolean) {
    val deadline = System.currentTimeMillis() + timeoutMs
    while (System.currentTimeMillis() < deadline) {
      var done = false
      InstrumentationRegistry.getInstrumentation().runOnMainSync { done = condition() }
      if (done) return
      Thread.sleep(50)
    }
    throw AssertionError("timed out waiting for the player")
  }

  private fun assertPlaysBothTracks(file: File, lengthMs: LongRange, video: String? = null, audio: String? = null): Playback {
    val playback = play(file)
    assertTrue("duration ${playback.durationMs} in $lengthMs", playback.durationMs in lengthMs)
    assertNotNull("a video track", playback.videoMime)
    assertNotNull("an audio track", playback.audioMime)
    video?.let { assertEquals(it, playback.videoMime) }
    audio?.let { assertEquals(it, playback.audioMime) }
    assertTrue("seekable", playback.seekable)
    assertTrue("seek landed near the middle (${playback.positionAfterSeekMs})", playback.positionAfterSeekMs in (lengthMs.first / 4)..(lengthMs.last * 3 / 4))
    return playback
  }

  @Test fun splitMp4TracksAreMergedLosslessly() {
    val result = process(
      ProcessingInput.Split(TrackFile(fixture("split-video.mp4"), TrackContainer.MP4), TrackFile(fixture("split-audio.m4a"), TrackContainer.MP4)),
    )
    assertEquals(ProcessingOperation.MERGE, result.operation)
    assertEquals(Container.MP4, result.container)
    assertPlaysBothTracks(result.file, 1_800L..2_300L, video = "video/avc", audio = "audio/mp4a-latm")
  }

  @Test fun transportStreamIsRemuxedIntoASeekableMp4() {
    val result = process(ProcessingInput.Single(TrackFile(fixture("av.ts"), TrackContainer.TS)))
    assertEquals(ProcessingOperation.REMUX, result.operation)
    assertPlaysBothTracks(result.file, 1_800L..2_300L, video = "video/avc", audio = "audio/mp4a-latm")
  }

  @Test fun separateTransportStreamRenditionsAreMergedInSync() {
    val result = process(
      ProcessingInput.Split(TrackFile(fixture("video.ts"), TrackContainer.TS), TrackFile(fixture("audio.ts"), TrackContainer.TS)),
    )
    assertEquals(ProcessingOperation.MERGE, result.operation)
    assertPlaysBothTracks(result.file, 1_800L..2_300L)
  }

  @Test fun vp9AndOpusTracksAreMergedIntoWebm() {
    val result = process(
      ProcessingInput.Split(TrackFile(fixture("vp9-video.webm"), TrackContainer.WEBM), TrackFile(fixture("opus-audio.webm"), TrackContainer.WEBM)),
    )
    assertEquals(ProcessingOperation.MERGE, result.operation)
    assertEquals(Container.WEBM, result.container)
    assertPlaysBothTracks(result.file, 3_700L..4_300L, video = "video/x-vnd.on2.vp9", audio = "audio/opus")
  }

  @Test fun mp3AudioIsTranscodedToAacAndTheVideoKept() {
    val result = process(ProcessingInput.Single(TrackFile(fixture("xvid-mp3.avi"), TrackContainer.AVI)))
    assertEquals(ProcessingOperation.TRANSCODE, result.operation)
    assertEquals(Container.MP4, result.container)
    // MPEG-4 Part 2 fits an MP4 and is copied; MP3 is converted to AAC.
    assertPlaysBothTracks(result.file, 1_800L..2_300L, video = "video/mp4v-es", audio = "audio/mp4a-latm")
  }

  @Test fun vp8VideoWithAacAudioIsTranscodedToH264() {
    // VP8 fits no MP4 and AAC no WebM: the video is re-encoded to H.264, the AAC copied.
    val result = process(
      ProcessingInput.Split(TrackFile(fixture("vp8-video.webm"), TrackContainer.WEBM), TrackFile(fixture("aac-audio.m4a"), TrackContainer.MP4)),
    )
    assertEquals(ProcessingOperation.TRANSCODE, result.operation)
    assertPlaysBothTracks(result.file, 3_600L..4_400L, video = "video/avc", audio = "audio/mp4a-latm")
  }

  @Test fun aWmvIsKeptAsDownloaded() {
    val wmv = fixture("video.wmv")
    val result = process(ProcessingInput.Single(TrackFile(wmv, TrackContainer.UNKNOWN)))
    assertEquals(ProcessingOperation.KEEP, result.operation)
    assertEquals(wmv, result.file)
  }
}
