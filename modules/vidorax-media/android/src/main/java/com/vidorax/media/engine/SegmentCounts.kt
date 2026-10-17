package com.vidorax.media.engine

import com.vidorax.media.transfer.HlsCheckpoint
import java.io.File
import java.util.concurrent.ConcurrentHashMap

/**
 * Segment Progress (#315): how many segments of a running HLS or DASH segment download are on disk, and how many
 * there are, for its progress events (`segmentsDone` / `segmentsTotal`).
 *
 * "Done" is what the tracks' checkpoints say — the segments durably in each `.part`, never a half-written one — summed
 * over the video and a separate audio track. A checkpoint is read at most once every [REFRESH_MS] per download,
 * whatever the number of progress samples, so this costs no more than the progress events it feeds (≤ 4 Hz).
 * A download with no segment track (a file, split files) has no entry: its events carry no segment fields.
 */
internal class SegmentCounts(
  private val now: () -> Long,
  private val readCompleted: (File) -> Int? = { HlsCheckpoint.read(it)?.completed },
) {
  /** One segment track: its checkpoint file and how many segments its plan has. */
  data class Track(val checkpoint: File, val segments: Int)

  private class Entry(val tracks: List<Track>) {
    val total: Int = tracks.sumOf { it.segments }
    @Volatile var readAt: Long = Long.MIN_VALUE
    @Volatile var done: Int = 0
  }

  private val entries = ConcurrentHashMap<String, Entry>()

  /** The segment tracks [id] downloads now (again after its playlists were re-read); none forgets it. */
  fun track(id: String, tracks: List<Track>) {
    val counted = tracks.filter { it.segments > 0 }
    if (counted.isEmpty()) {
      entries.remove(id)
      return
    }
    // Bounded: entries of downloads that stopped (paused, failed) are only replaced or dropped here.
    if (entries.size >= MAX_ENTRIES && !entries.containsKey(id)) entries.keys.firstOrNull()?.let { entries.remove(it) }
    entries[id] = Entry(counted)
  }

  fun forget(id: String) {
    entries.remove(id)
  }

  /** (done, total) for [id], or null when it has no segment track. Done never exceeds total. */
  fun of(id: String): Pair<Int, Int>? {
    val entry = entries[id] ?: return null
    val t = now()
    if (entry.readAt == Long.MIN_VALUE || t - entry.readAt >= REFRESH_MS || t < entry.readAt) {
      entry.done = entry.tracks.sumOf { track ->
        (runCatching { readCompleted(track.checkpoint) }.getOrNull() ?: 0).coerceIn(0, track.segments)
      }
      entry.readAt = t
    }
    return entry.done.coerceAtMost(entry.total) to entry.total
  }

  companion object {
    /** The same pace as the progress events themselves (DownloadEngine.PROGRESS_EMIT_MS). */
    const val REFRESH_MS = 250L
    const val MAX_ENTRIES = 64
  }
}
