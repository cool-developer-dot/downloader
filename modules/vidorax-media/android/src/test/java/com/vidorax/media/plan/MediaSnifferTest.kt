package com.vidorax.media.plan

import com.vidorax.media.model.Container
import com.vidorax.media.model.ProbeFailure
import org.junit.Assert.assertEquals
import org.junit.Assert.assertFalse
import org.junit.Assert.assertTrue
import org.junit.Test

class MediaSnifferTest {
  // --- supported progressive containers ---

  @Test fun classifiesRealProgressiveMp4() {
    val bytes = fixture("/media/progressive/av.mp4")
    assertSupported(Container.MP4, sniff(bytes, url = "https://cdn.example/av.mp4", total = bytes.size.toLong()))
  }

  @Test fun classifiesVideoOnlyMp4() {
    val bytes = fixture("/media/progressive/video-only.mp4")
    assertSupported(Container.MP4, sniff(bytes, total = bytes.size.toLong()))
  }

  @Test fun classifiesQuickTimeMovByBrand() {
    val bytes = ftyp("qt  ") + box("mdat", ByteArray(16))
    assertSupported(Container.MOV, sniff(bytes, url = "https://cdn.example/opaque", total = bytes.size.toLong()))
  }

  @Test fun classifiesWebmByDocType() {
    val bytes = byteArrayOf(0x1A, 0x45, 0xDF.toByte(), 0xA3.toByte()) + "  webm  ".toByteArray()
    assertSupported(Container.WEBM, sniff(bytes, total = bytes.size.toLong()))
  }

  @Test fun classifiesAvi() {
    val bytes = "RIFF".toByteArray() + ByteArray(4) + "AVI ".toByteArray() + ByteArray(32)
    assertSupported(Container.AVI, sniff(bytes, total = bytes.size.toLong()))
  }

  @Test fun classifiesWmvByAsfGuid() {
    val guid = byteArrayOf(
      0x30, 0x26, 0xB2.toByte(), 0x75, 0x8E.toByte(), 0x66, 0xCF.toByte(), 0x11,
      0xA6.toByte(), 0xD9.toByte(), 0x00, 0xAA.toByte(), 0x00, 0x62, 0xCE.toByte(), 0x6C,
    )
    assertSupported(Container.WMV, sniff(guid + ByteArray(32), total = 48))
  }

  // --- F4V, 3GPP2 and DivX (real ffmpeg files in /media/process) ---

  @Test fun classifiesF4vAsMp4() {
    val bytes = fixture("/media/process/sample.f4v")
    assertEquals("ftyp major brand", "f4v ", String(bytes, 8, 4, Charsets.US_ASCII))
    assertSupported(Container.MP4, sniff(bytes, url = "https://cdn.example/show.f4v", total = bytes.size.toLong()))
    // The bytes decide: the same file behind an opaque link is still MP4.
    assertSupported(Container.MP4, sniff(bytes, contentType = "video/x-f4v", url = "https://cdn.example/s/91", total = bytes.size.toLong()))
  }

  @Test fun classifiesThreeGpp2ByBrand() {
    val bytes = fixture("/media/process/sample.3g2")
    assertEquals("ftyp major brand", "3g2a", String(bytes, 8, 4, Charsets.US_ASCII))
    assertSupported(Container.THREE_G2, sniff(bytes, url = "https://cdn.example/clip.3g2", total = bytes.size.toLong()))
    assertSupported(Container.THREE_G2, sniff(bytes, url = "https://cdn.example/opaque", total = bytes.size.toLong()))
  }

  @Test fun classifiesDivxAndDivx3AsAvi() {
    for (name in listOf("divx-mp3.divx", "div3-mp3.divx")) {
      val bytes = fixture("/media/process/$name")
      assertSupported(Container.AVI, sniff(bytes, contentType = "video/divx", url = "https://cdn.example/$name", total = bytes.size.toLong()))
    }
  }

  @Test fun refusesDrmBrandedF4v() {
    val payload = "f4v ".toByteArray() + byteArrayOf(0, 0, 0, 0) + "f4v ".toByteArray() + "cenc".toByteArray()
    val bytes = box("ftyp", payload) + box("mdat", ByteArray(16))
    assertUnsupported(ProbeFailure.DRM_PROTECTED, sniff(bytes, url = "https://cdn.example/show.f4v", total = bytes.size.toLong()))
  }

  @Test fun refusesF4vWithProtectedSampleEntries() {
    val bytes = ftyp("f4v ") + box("moov", box("trak", box("sinf", ByteArray(16)))) + box("mdat", ByteArray(16))
    assertUnsupported(ProbeFailure.DRM_PROTECTED, sniff(bytes, url = "https://cdn.example/show.f4v", total = bytes.size.toLong()))
  }

  @Test fun acceptsExtensionlessUrlFromMagicBytes() {
    val bytes = fixture("/media/progressive/av.mp4")
    // No extension in the URL at all: classification must come from bytes, not the path.
    assertSupported(Container.MP4, sniff(bytes, url = "https://cdn.example/stream/7f3a9b2c", total = bytes.size.toLong()))
  }

  @Test fun doesNotRejectLargeMp4WithMetadataBeyondProbe() {
    // ftyp then a moov whose declared size runs far past the bytes we have: the real file continues, so it is
    // complete, not an init-only segment. totalSize is unknown here (a big streamed file).
    val prefix = ftyp("isom") + boxHeader("moov", 10_000_000)
    assertSupported(Container.MP4, sniff(prefix, total = null))
  }

  // --- rejected: out of scope or incomplete ---

  @Test fun rejectsIsolatedMediaFragment() {
    val bytes = fixture("/media/hls-fmp4/video0.m4s")
    assertUnsupported(ProbeFailure.UNSUPPORTED_FORMAT, sniff(bytes, total = bytes.size.toLong()))
  }

  @Test fun rejectsIsolatedInitSegment() {
    val bytes = fixture("/media/hls-fmp4/video-init.mp4")
    // Whole file is present and it carries no mdat/moof: an init segment, not a downloadable file.
    assertUnsupported(ProbeFailure.UNSUPPORTED_FORMAT, sniff(bytes, total = bytes.size.toLong()))
  }

  @Test fun rejectsMatroska() {
    val bytes = fixture("/media/progressive/vp8-vorbis.mkv")
    assertUnsupported(ProbeFailure.UNSUPPORTED_FORMAT, sniff(bytes, total = bytes.size.toLong()))
  }

  @Test fun rejectsTransportStream() {
    val bytes = fixture("/media/hls-ts/seg0.ts")
    assertUnsupported(ProbeFailure.UNSUPPORTED_FORMAT, sniff(bytes, total = bytes.size.toLong()))
  }

  @Test fun rejectsDrmByBrand() {
    val bytes = ftyp("cenc") + box("mdat", ByteArray(16))
    assertUnsupported(ProbeFailure.DRM_PROTECTED, sniff(bytes, total = bytes.size.toLong()))
  }

  @Test fun rejectsDrmByPsshBox() {
    val bytes = ftyp("isom") + box("pssh", ByteArray(20)) + box("mdat", ByteArray(16))
    assertUnsupported(ProbeFailure.DRM_PROTECTED, sniff(bytes, total = bytes.size.toLong()))
  }

  @Test fun rejectsDash() {
    val xml = """<?xml version="1.0"?><MPD xmlns="urn:mpeg:dash:schema:mpd:2011"></MPD>""".toByteArray()
    assertUnsupported(ProbeFailure.UNSUPPORTED_FORMAT, sniff(xml, contentType = "application/dash+xml"))
  }

  @Test fun rejectsHls() {
    val playlist = "#EXTM3U\n#EXT-X-VERSION:3\n".toByteArray()
    assertUnsupported(ProbeFailure.UNSUPPORTED_FORMAT, sniff(playlist))
  }

  @Test fun acceptsTransportStreamOnlyWhenAnHlsDownloadAssembledIt() {
    val bytes = fixture("/media/hls-ts/seg0.ts") + fixture("/media/hls-ts/seg1.ts")
    assertSupported(Container.TS, MediaSniffer.sniff(bytes, null, "x.ts", bytes.size.toLong(), allowTransportStream = true))
    val misaligned = bytes.copyOf().also { it[188 * 5] = 0 }
    assertUnsupported(
      ProbeFailure.UNSUPPORTED_FORMAT,
      MediaSniffer.sniff(misaligned, null, "x.ts", misaligned.size.toLong(), allowTransportStream = true),
    )
  }

  @Test fun recognisesAPlaylistWhateverTheUrlSays() {
    assertTrue(MediaSniffer.isHlsPlaylist("﻿\n  #EXTM3U\n#EXT-X-VERSION:3".toByteArray()))
    assertTrue(!MediaSniffer.isHlsPlaylist(fixture("/media/progressive/av.mp4")))
  }

  @Test fun rejectsEncryptedWebmAsDrm() {
    val ebml = byteArrayOf(0x1A, 0x45, 0xDF.toByte(), 0xA3.toByte()) + "  webm  ".toByteArray()
    // Tracks > TrackEntry > ContentEncodings (6D80) > ContentEncoding > ContentEncryption (5035) > ContentEncAlgo (47E1)
    val encrypted = ebml + byteArrayOf(0x16, 0x54, 0xAE.toByte(), 0x6B, 0x6D, 0x80.toByte(), 0x62, 0x40, 0x50, 0x35, 0x47, 0xE1.toByte(), 0x81.toByte(), 0x05) +
      byteArrayOf(0x1F, 0x43, 0xB6.toByte(), 0x75) + ByteArray(64)
    assertUnsupported(ProbeFailure.DRM_PROTECTED, sniff(encrypted))
    // The same element ids appearing only inside a Cluster (compressed frame data) are not a declaration.
    val clear = ebml + byteArrayOf(0x1F, 0x43, 0xB6.toByte(), 0x75, 0x6D, 0x80.toByte(), 0x50, 0x35, 0x47, 0xE1.toByte()) + ByteArray(64)
    assertSupported(Container.WEBM, sniff(clear))
  }

  @Test fun rejectsHtmlAsNotMedia() {
    val html = "<!DOCTYPE html><html><body>nope</body></html>".toByteArray()
    assertUnsupported(ProbeFailure.NOT_MEDIA, sniff(html, contentType = "text/html"))
  }

  @Test fun rejectsEmptyBody() {
    assertUnsupported(ProbeFailure.NOT_MEDIA, sniff(ByteArray(0)))
  }

  // --- helpers ---

  private fun sniff(bytes: ByteArray, contentType: String? = null, url: String = "https://cdn.example/x", total: Long? = null) =
    MediaSniffer.sniff(bytes, contentType, url, total)

  // --- audio only ---

  @Test fun anAudioOnlyFileIsRecognisedWhenItsTrackListIsInTheBytes() {
    // moov after mdat, but the whole small file is in the read.
    assertTrue(MediaSniffer.isAudioOnly(fixture("/media/progressive/audio-only.m4a")))
    // The audio half of a stream split into separate audio and video files (an fMP4 rendition).
    assertTrue(MediaSniffer.isAudioOnly(fixture("/media/hls-fmp4/audio-init.mp4") + fixture("/media/hls-fmp4/audio0.m4s")))
  }

  @Test fun aFileWithAVideoTrackIsNeverAudioOnly() {
    assertFalse(MediaSniffer.isAudioOnly(fixture("/media/progressive/av.mp4")))
    assertFalse(MediaSniffer.isAudioOnly(fixture("/media/progressive/video-only.mp4")))
    assertFalse(MediaSniffer.isAudioOnly(fixture("/media/hls-fmp4/video-init.mp4")))
  }

  @Test fun audioOnlyNeedsTheWholeTrackList() {
    val file = fixture("/media/progressive/audio-only.m4a") // ftyp, free, mdat, then moov at 2401
    assertFalse("read ends inside the moov", MediaSniffer.isAudioOnly(file.copyOf(2401 + 100)))
    assertFalse("read ends before the moov", MediaSniffer.isAudioOnly(file.copyOf(2401)))
    assertFalse("not ISO-BMFF", MediaSniffer.isAudioOnly("#EXTM3U\n".toByteArray()))
  }

  @Test fun aQuickTimeSoundHandlerCountsAsAudio() {
    // QuickTime hdlr: version/flags, component type "mhlr", then the subtype.
    val hdlr = box("hdlr", ByteArray(4) + "mhlr".toByteArray() + "soun".toByteArray() + ByteArray(12))
    assertTrue(MediaSniffer.isAudioOnly(ftyp("qt  ") + box("moov", box("trak", box("mdia", hdlr))) + box("mdat", ByteArray(16))))
  }

  // --- DASH manifests are recognised from their markup, not the URL ---

  @Test fun recognisesAnMpdAfterAnXmlDeclarationAndComments() {
    val comment = "<!-- " + "x".repeat(3000) + " -->"
    val xml = """<?xml version="1.0" encoding="UTF-8"?>
      |$comment
      |<MPD xmlns="urn:mpeg:dash:schema:mpd:2011" type="static"></MPD>""".trimMargin().toByteArray()
    assertTrue(MediaSniffer.isDashManifest(xml))
    assertTrue(MediaSniffer.isDashManifest("""<dash:MPD xmlns:dash="urn:mpeg:dash:schema:mpd:2011"/>""".toByteArray()))
  }

  @Test fun otherMarkupIsNotAnMpd() {
    assertFalse(MediaSniffer.isDashManifest("<!doctype html><html><body>MPD</body></html>".toByteArray()))
    assertFalse(MediaSniffer.isDashManifest("""{"mpd": "<MPD>"}""".toByteArray()))
    assertFalse(MediaSniffer.isDashManifest("<mpdx/>".toByteArray()))
    assertFalse(MediaSniffer.isDashManifest(fixture("/media/progressive/av.mp4")))
  }

  // --- audio files are named as what they are ---

  @Test fun mp3AndAacAreAudioFilesNotUnrecognized() {
    for ((path, name) in listOf("/media/formats/with-id3.mp3" to "MP3", "/media/formats/no-id3.mp3" to "MP3", "/media/formats/audio.aac" to "AAC")) {
      val result = sniff(fixture(path), contentType = "audio/mpeg")
      assertUnsupported(ProbeFailure.UNSUPPORTED_FORMAT, result)
      assertTrue("$path → ${(result as SniffResult.Unsupported).detail}", result.detail.contains(name))
    }
  }

  @Test fun anM4aIsAudioEvenWhenItsTrackListIsStoredAtTheEnd() {
    val file = fixture("/media/formats/audio-moov-at-end.m4a") // ftyp M4A, free, mdat, then moov at 72680
    val prefix = file.copyOf(4096)
    assertFalse("the track list is not in the prefix", MediaSniffer.isAudioOnly(prefix))
    val result = sniff(prefix, contentType = "audio/mp4", total = file.size.toLong())
    assertUnsupported(ProbeFailure.UNSUPPORTED_FORMAT, result)
    assertTrue((result as SniffResult.Unsupported).detail.contains("M4A"))
  }

  @Test fun realMovAndWebmFixturesAreSupported() {
    val mov = fixture("/media/formats/qt.mov")
    assertSupported(Container.MOV, sniff(mov, url = "https://cdn.example/opaque", total = mov.size.toLong()))
    val webm = fixture("/media/formats/video.webm")
    assertSupported(Container.WEBM, sniff(webm, total = webm.size.toLong()))
  }

  // --- WebM audio-only is read from the track list, not guessed ---

  @Test fun aWebmWithAVideoTrackIsNeverAudioOnly() {
    assertFalse(MediaSniffer.isAudioOnly(fixture("/media/formats/video.webm")))
  }

  @Test fun anOpusOnlyWebmIsAudioOnly() {
    assertTrue(MediaSniffer.isAudioOnly(fixture("/media/formats/audio-only.webm")))
  }

  @Test fun aWebmCutBeforeItsTrackListCannotBeCalledAudioOnly() {
    val audio = fixture("/media/formats/audio-only.webm")
    assertFalse(MediaSniffer.isAudioOnly(audio.copyOf(40)))
  }

  private fun assertSupported(container: Container, result: SniffResult) {
    assertTrue("expected Supported, got $result", result is SniffResult.Supported)
    assertEquals(container, (result as SniffResult.Supported).container)
  }

  // --- track list stored after the media data (no "fast start") ---

  @Test fun findsWhereTheTrackListOfAFileWithoutFastStartBegins() {
    val bytes = fixture("/media/formats/video-moov-at-end.mp4")
    val prefix = bytes.copyOf(Probe.PROBE_BYTES)
    // ftyp (32) + free (8) + mdat (121957): the moov starts right after the media data.
    assertEquals(121_997L, MediaSniffer.trailingBoxesOffset(prefix))
  }

  @Test fun aFastStartFileHasNoTrailingTrackListToFetch() {
    val bytes = fixture("/media/progressive/av.mp4")
    assertEquals(null, MediaSniffer.trailingBoxesOffset(bytes.copyOf(minOf(bytes.size, Probe.PROBE_BYTES))))
    // Not ISO-BMFF, or a box that runs to the end of the file: nothing to fetch either.
    assertEquals(null, MediaSniffer.trailingBoxesOffset("RIFF....AVI ".toByteArray() + ByteArray(64)))
    assertEquals(null, MediaSniffer.trailingBoxesOffset(ftyp("isom") + boxHeader("mdat", 0) + ByteArray(64)))
  }

  @Test fun anEncryptedTrailingTrackListIsProtected() {
    val bytes = fixture("/media/formats/cenc-moov-at-end.mp4")
    val offset = MediaSniffer.trailingBoxesOffset(bytes.copyOf(Probe.PROBE_BYTES))!!.toInt()
    val verdict = MediaSniffer.trailingMoovVerdict(bytes.copyOfRange(offset, bytes.size))
    assertEquals(ProbeFailure.DRM_PROTECTED, verdict?.reason)
  }

  @Test fun aTrailingTrackListWithSoundOnlyIsNotAVideo() {
    val bytes = fixture("/media/formats/audio-moov-at-end.mp4")
    val offset = MediaSniffer.trailingBoxesOffset(bytes.copyOf(Probe.PROBE_BYTES))!!.toInt()
    val verdict = MediaSniffer.trailingMoovVerdict(bytes.copyOfRange(offset, bytes.size))
    assertEquals(ProbeFailure.UNSUPPORTED_FORMAT, verdict?.reason)
  }

  @Test fun aClearTrailingVideoTrackListProvesNothingAgainstTheFile() {
    val bytes = fixture("/media/formats/video-moov-at-end.mp4")
    val offset = MediaSniffer.trailingBoxesOffset(bytes.copyOf(Probe.PROBE_BYTES))!!.toInt()
    assertEquals(null, MediaSniffer.trailingMoovVerdict(bytes.copyOfRange(offset, bytes.size)))
    // Bytes that are not a moov (another box, or garbage) prove nothing either.
    assertEquals(null, MediaSniffer.trailingMoovVerdict(box("free", ByteArray(32))))
  }

  private fun assertUnsupported(reason: ProbeFailure, result: SniffResult) {
    assertTrue("expected Unsupported, got $result", result is SniffResult.Unsupported)
    assertEquals(reason, (result as SniffResult.Unsupported).reason)
  }

  private fun fixture(path: String): ByteArray =
    checkNotNull(javaClass.getResourceAsStream(path)) { "missing test fixture $path" }.use { it.readBytes() }

  private fun ftyp(majorBrand: String): ByteArray {
    require(majorBrand.length == 4)
    val payload = majorBrand.toByteArray() + byteArrayOf(0, 0, 0, 0) + majorBrand.toByteArray()
    return box("ftyp", payload)
  }

  private fun box(type: String, payload: ByteArray): ByteArray {
    require(type.length == 4)
    val size = 8 + payload.size
    return be32(size) + type.toByteArray(Charsets.US_ASCII) + payload
  }

  private fun boxHeader(type: String, declaredSize: Int): ByteArray {
    require(type.length == 4)
    return be32(declaredSize) + type.toByteArray(Charsets.US_ASCII)
  }

  private fun be32(v: Int): ByteArray =
    byteArrayOf((v ushr 24).toByte(), (v ushr 16).toByte(), (v ushr 8).toByte(), v.toByte())
}
