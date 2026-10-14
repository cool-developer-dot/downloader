package com.vidorax.media.transfer

/** What an assembled `.part` holds for MPEG-TS segments: their bytes in order, the joins renumbered ([TsContinuity]). */
internal object TsJoin {
  fun of(vararg segments: ByteArray): ByteArray {
    val bytes = segments.fold(ByteArray(0)) { joined, segment -> joined + segment }
    TsContinuity().renumberPackets(bytes, bytes.size)
    return bytes
  }
}
