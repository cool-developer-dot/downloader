package com.vidorax.media.engine

import com.vidorax.media.engine.PartialRepair.SegmentFacts
import com.vidorax.media.engine.PartialRepair.TailAnswer
import com.vidorax.media.engine.PartialRepair.Verdict
import com.vidorax.media.model.Container
import com.vidorax.media.transfer.HlsCheckpoint
import org.junit.Assert.assertEquals
import org.junit.Assert.assertFalse
import org.junit.Assert.assertTrue
import org.junit.Test

/** H20 Repair Partial File (#412): the decision table, without a server. */
class PartialRepairTest {
  private val part = 1_000_000L
  private val start = part - PartialRepair.TAIL_BYTES

  private fun whole(validator: String?, answer: TailAnswer) = PartialRepair.decideWhole(part, start, validator, answer)

  @Test fun aWholeFileThatChecksOutResumes() {
    assertEquals(Verdict.VALID, whole("\"v1\"", TailAnswer(206, start, 5_000_000, "\"v1\"", bytesMatch = true)))
    assertEquals("no validator either side: the bytes decide", Verdict.VALID, whole(null, TailAnswer(206, start, null, null, true)))
    assertEquals("an unquoted ETag is the same entity-tag", Verdict.VALID, whole("\"v1\"", TailAnswer(206, start, null, "v1", true)))
  }

  @Test fun aChangedFileOnTheServerRestartsFromZero() {
    assertEquals("If-Range no longer matched: the whole new file came back", Verdict.CHANGED, whole("\"v1\"", TailAnswer(200)))
    assertEquals(Verdict.CHANGED, whole("\"v1\"", TailAnswer(206, start, 5_000_000, "\"v2\"", bytesMatch = true)))
    assertEquals("now shorter than the partial", Verdict.CHANGED, whole(null, TailAnswer(206, start, part - 1, null, true)))
    assertEquals(Verdict.CHANGED, whole(null, TailAnswer(416)))
  }

  @Test fun damagedBytesRestartFromZero() {
    assertEquals(Verdict.CORRUPT, whole("\"v1\"", TailAnswer(206, start, 5_000_000, "\"v1\"", bytesMatch = false)))
  }

  @Test fun aServerThatCannotContinueTheFileRestartsFromZero() {
    assertEquals("ignored the range, nothing to compare against", Verdict.NO_RESUME, whole(null, TailAnswer(200)))
    assertEquals("answered another range", Verdict.NO_RESUME, whole(null, TailAnswer(206, 0, 5_000_000, null, null)))
  }

  @Test fun whatCannotBeCheckedNowChangesNothing() {
    for (status in listOf(null, 401, 403, 404, 410, 429, 500, 503)) {
      assertEquals("$status", Verdict.UNREACHABLE, whole("\"v1\"", TailAnswer(status)))
    }
    assertEquals("a 206 whose bytes could not be read", Verdict.UNREACHABLE, whole(null, TailAnswer(206, start, null, null, null)))
  }

  private fun checkpoint(completed: Int, partBytes: Long, packedAudio: Boolean = false) =
    HlsCheckpoint("fp", completed, partBytes, null, Container.TS, packedAudio = packedAudio)

  private fun segments(
    checkpoint: HlsCheckpoint?,
    partLength: Long = 5_000,
    fingerprint: String? = "fp",
    length: Long? = 1_000,
    matches: Boolean? = true,
  ) = PartialRepair.decideSegments(SegmentFacts(checkpoint, partLength, fingerprint, length, matches))

  @Test fun segmentsThatCheckOutResume() {
    assertEquals(Verdict.VALID, segments(checkpoint(3, 5_000)))
    assertEquals("nothing durable yet", Verdict.VALID, segments(null))
    assertEquals(Verdict.VALID, segments(checkpoint(0, 0)))
    assertEquals("packed audio cannot be compared: the checkpoint is trusted", Verdict.VALID, segments(checkpoint(3, 5_000, packedAudio = true), matches = null, length = null))
  }

  @Test fun aDamagedLastSegmentIsFetchedAgain() {
    assertEquals(Verdict.SEGMENT_DAMAGED, segments(checkpoint(3, 5_000), matches = false))
  }

  @Test fun anotherStreamOrMissingBytesRestartTheTrack() {
    assertEquals(Verdict.CHANGED, segments(checkpoint(3, 5_000), fingerprint = "other"))
    assertEquals("the part is shorter than its checkpoint", Verdict.CORRUPT, segments(checkpoint(3, 5_000), partLength = 4_999))
    assertEquals("a segment longer than all the bytes", Verdict.CORRUPT, segments(checkpoint(3, 5_000), length = 6_000))
  }

  @Test fun segmentsThatCannotBeCheckedNowChangeNothing() {
    assertEquals(Verdict.UNREACHABLE, segments(checkpoint(3, 5_000), fingerprint = null))
    assertEquals(Verdict.UNREACHABLE, segments(checkpoint(3, 5_000), length = null, matches = null))
  }

  @Test fun oneUncheckableTrackLeavesEverythingAsItIs() {
    assertEquals(RepairOutcome.NOTHING, PartialRepair.outcomeOf(emptyList()))
    assertEquals(RepairOutcome.UNREACHABLE, PartialRepair.outcomeOf(listOf(Verdict.CHANGED, Verdict.UNREACHABLE)))
    assertEquals(RepairOutcome.RESTARTED_CHANGED, PartialRepair.outcomeOf(listOf(Verdict.VALID, Verdict.CHANGED, Verdict.CORRUPT)))
    assertEquals(RepairOutcome.RESTARTED_CORRUPT, PartialRepair.outcomeOf(listOf(Verdict.CORRUPT, Verdict.NO_RESUME)))
    assertEquals(RepairOutcome.RESTARTED_NO_RESUME, PartialRepair.outcomeOf(listOf(Verdict.NO_RESUME, Verdict.SEGMENT_DAMAGED)))
    assertEquals(RepairOutcome.SEGMENT_REFETCHED, PartialRepair.outcomeOf(listOf(Verdict.VALID, Verdict.SEGMENT_DAMAGED)))
    assertEquals(RepairOutcome.RESUMED, PartialRepair.outcomeOf(listOf(Verdict.VALID, Verdict.VALID)))
  }

  @Test fun validatorsAreComparedAsEntityTags() {
    assertTrue(PartialRepair.sameValidator("\"abc\"", "abc"))
    assertTrue(PartialRepair.sameValidator("Wed, 21 Oct 2026 07:28:00 GMT", " Wed, 21 Oct 2026 07:28:00 GMT "))
    assertFalse(PartialRepair.sameValidator("\"abc\"", "\"abd\""))
  }

  @Test fun everyOutcomeHasItsContractWire() {
    assertEquals(
      listOf("resumed", "restarted_changed", "restarted_corrupt", "restarted_no_resume", "segment_refetched", "unreachable", "nothing"),
      RepairOutcome.values().map { it.wire },
    )
  }
}
