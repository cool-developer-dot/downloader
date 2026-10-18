package com.vidorax.media.subtitles

import java.io.ByteArrayOutputStream

/** Builds the fMP4 boxes of a `wvtt` track the way packagers write them (test fixtures for #370). */
internal object Fmp4Builder {
  class Sample(val durationTicks: Long, val payload: ByteArray)

  fun u16(value: Int) = byteArrayOf((value shr 8).toByte(), value.toByte())

  fun u32(value: Long) = byteArrayOf((value shr 24).toByte(), (value shr 16).toByte(), (value shr 8).toByte(), value.toByte())

  fun u64(value: Long) = u32(value ushr 32) + u32(value and 0xFFFFFFFFL)

  fun text(value: String) = value.toByteArray(Charsets.UTF_8)

  fun box(type: String, vararg parts: ByteArray): ByteArray {
    val body = ByteArrayOutputStream().apply { parts.forEach { write(it) } }.toByteArray()
    return u32((8 + body.size).toLong()) + type.toByteArray(Charsets.ISO_8859_1) + body
  }

  fun full(type: String, version: Int, flags: Int, vararg parts: ByteArray): ByteArray =
    box(type, byteArrayOf(version.toByte(), (flags shr 16).toByte(), (flags shr 8).toByte(), flags.toByte()), *parts)

  /** An init segment with one text track; [sampleEntry] `wvtt` (or anything else, for a track that is not WebVTT). */
  fun init(trackId: Long = 2, timescale: Long = 1_000, sampleEntry: String = "wvtt"): ByteArray {
    val tkhd = full("tkhd", 0, 3, u32(0), u32(0), u32(trackId), u32(0), u32(0), ByteArray(60))
    val mdhd = full("mdhd", 0, 0, u32(0), u32(0), u32(timescale), u32(0), u16(0x55C4), u16(0))
    val hdlr = full("hdlr", 0, 0, u32(0), text("text"), ByteArray(12), byteArrayOf(0))
    val entry = box(sampleEntry, ByteArray(6), u16(1), box("vttC", text("WEBVTT")))
    val stbl = box("stbl", full("stsd", 0, 0, u32(1), entry))
    val trak = box("trak", tkhd, box("mdia", mdhd, hdlr, box("minf", stbl)))
    val mvex = box("mvex", full("trex", 0, 0, u32(trackId), u32(1), u32(0), u32(0), u32(0)))
    return box("ftyp", text("iso6"), u32(0), text("iso6")) + box("moov", trak, mvex)
  }

  fun cue(text: String, settings: String = ""): ByteArray =
    if (settings.isEmpty()) box("vttc", box("payl", text(text))) else box("vttc", box("sttg", text(settings)), box("payl", text(text)))

  fun empty(): ByteArray = box("vtte")

  /** One `moof` + `mdat` of [trackId] starting at [baseTime] (track ticks); every sample has its duration and size. */
  fun fragment(trackId: Long = 2, baseTime: Long, samples: List<Sample>): ByteArray {
    fun moof(dataOffset: Long): ByteArray {
      val tfhd = full("tfhd", 0, 0x020000, u32(trackId))
      val tfdt = full("tfdt", 1, 0, u64(baseTime))
      val perSample = samples.map { u32(it.durationTicks) + u32(it.payload.size.toLong()) }.toTypedArray()
      val trun = full("trun", 0, 0x301, u32(samples.size.toLong()), u32(dataOffset), *perSample)
      return box("moof", full("mfhd", 0, 0, u32(1)), box("traf", tfhd, tfdt, trun))
    }
    val size = moof(0).size
    return moof((size + 8).toLong()) + box("mdat", *samples.map { it.payload }.toTypedArray())
  }
}
