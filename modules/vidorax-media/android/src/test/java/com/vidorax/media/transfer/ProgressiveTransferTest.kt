package com.vidorax.media.transfer

import com.vidorax.media.model.RequestContext
import com.vidorax.media.net.HttpClient
import com.vidorax.media.net.UrlPolicy
import com.vidorax.media.net.MediaNetworkException
import java.io.File
import kotlinx.coroutines.Dispatchers
import kotlinx.coroutines.Job
import kotlinx.coroutines.launch
import kotlinx.coroutines.runBlocking
import okhttp3.mockwebserver.MockResponse
import okhttp3.mockwebserver.MockWebServer
import okio.Buffer
import org.junit.After
import org.junit.Assert.assertArrayEquals
import org.junit.Assert.assertEquals
import org.junit.Assert.assertFalse
import org.junit.Assert.assertThrows
import org.junit.Assert.assertTrue
import org.junit.Before
import org.junit.Rule
import org.junit.Test
import org.junit.rules.TemporaryFolder

class ProgressiveTransferTest {
  @get:Rule val tmp = TemporaryFolder()

  private lateinit var server: MockWebServer
  private val transfer = ProgressiveTransfer(HttpClient.create(urlPolicy = UrlPolicy.ALLOW_ALL))
  private val context = RequestContext(null, null, null, emptyMap(), useCookies = false)

  @Before fun setUp() { server = MockWebServer().apply { start() } }

  @After fun tearDown() { runCatching { server.shutdown() } }

  private fun spec(part: File, validator: String? = null) =
    TransferSpec(url = server.url("/file").toString(), context = context, partFile = part, validator = validator)

  @Test fun freshDownloadWritesWholeFile() = runBlocking {
    val body = "HELLO-VIDORAX-PROGRESSIVE".toByteArray()
    server.enqueue(MockResponse().setResponseCode(200).setBody(Buffer().write(body)))
    val part = tmp.newFile("a.part")

    val outcome = transfer.transfer(spec(part))

    assertArrayEquals(body, part.readBytes())
    assertEquals(body.size.toLong(), outcome.bytesWritten)
    assertEquals(body.size.toLong(), outcome.totalBytes)
  }

  @Test fun validRangeResumeAppendsWithoutRefetch() = runBlocking {
    val full = ByteArray(2000) { (it % 251).toByte() }
    val already = 800
    val part = tmp.newFile("b.part").apply { writeBytes(full.copyOfRange(0, already)) }
    server.enqueue(
      MockResponse().setResponseCode(206)
        .setHeader("Content-Range", "bytes $already-${full.size - 1}/${full.size}")
        .setBody(Buffer().write(full.copyOfRange(already, full.size))),
    )

    val outcome = transfer.transfer(spec(part, validator = "\"etag-9\""))

    assertArrayEquals(full, part.readBytes())
    assertEquals(full.size.toLong(), outcome.totalBytes)
    val recorded = server.takeRequest()
    assertEquals("bytes=$already-", recorded.getHeader("Range"))
    assertEquals("\"etag-9\"", recorded.getHeader("If-Range"))
  }

  @Test fun mismatchedContentRangeRestartsFromZero() = runBlocking {
    val full = ByteArray(1200) { (it % 97).toByte() }
    val part = tmp.newFile("c.part").apply { writeBytes(full.copyOfRange(0, 500)) }
    // First: a 206 whose range does not begin where our partial ends — unusable.
    server.enqueue(
      MockResponse().setResponseCode(206)
        .setHeader("Content-Range", "bytes 999-1199/1200")
        .setBody(Buffer().write(ByteArray(201))),
    )
    // Second (the restart, a plain GET): the whole resource from byte 0.
    server.enqueue(MockResponse().setResponseCode(200).setBody(Buffer().write(full)))

    val outcome = transfer.transfer(spec(part, validator = "\"etag\""))

    assertArrayEquals(full, part.readBytes())
    assertEquals(full.size.toLong(), outcome.bytesWritten)
    assertEquals(2, server.requestCount)
  }

  @Test fun statusTwoHundredOnRangeRequestTruncatesInsteadOfAppending() = runBlocking {
    val stalePartial = ByteArray(500) { 1 }
    val freshFull = ByteArray(1400) { 2 }
    val part = tmp.newFile("d.part").apply { writeBytes(stalePartial) }
    // Server ignores the Range (or If-Range no longer matches): a full 200 from byte 0.
    server.enqueue(MockResponse().setResponseCode(200).setBody(Buffer().write(freshFull)))

    val outcome = transfer.transfer(spec(part, validator = "\"old-etag\""))

    // The partial must be discarded and rewritten, never appended: length is exactly the fresh body.
    assertEquals(freshFull.size.toLong(), part.length())
    assertArrayEquals(freshFull, part.readBytes())
    assertEquals(freshFull.size.toLong(), outcome.bytesWritten)
  }

  @Test fun cancellationPreservesPartFile() {
    val body = ByteArray(256 * 1024) { (it % 255).toByte() }
    server.enqueue(MockResponse().setResponseCode(200).setBody(Buffer().write(body)))
    val part = tmp.newFile("e.part")

    runBlocking {
      var job: Job? = null
      job = launch(Dispatchers.IO) {
        transfer.transfer(spec(part)) { bytesDone, _ -> if (bytesDone >= 64 * 1024) job?.cancel() }
      }
      job.join()
      assertTrue(job.isCancelled)
    }

    // Paused, not finished: the `.part` survives with some but not all of the bytes.
    assertTrue(part.exists())
    assertTrue("expected partial bytes, got ${part.length()}", part.length() in 1 until body.size.toLong())
  }

  @Test fun shortBodyAgainstKnownTotalIsTransientFailureAndKeepsPart() {
    val part = tmp.newFile("f.part")
    // Declares a 100-byte instance but only delivers 40: a truncated transfer, not a finished file.
    server.enqueue(
      MockResponse().setResponseCode(206)
        .setHeader("Content-Range", "bytes 0-99/100")
        .setBody(Buffer().write(ByteArray(40) { 7 })),
    )

    assertThrows(MediaNetworkException::class.java) {
      runBlocking { transfer.transfer(spec(part)) }
    }
    assertTrue(part.exists())
    assertEquals(40L, part.length())
  }

  @Test fun resumeAfterAProcessRestartSendsTheValidatorRecordedWithTheFirstBytes() {
    val full = ByteArray(2000) { (it % 211).toByte() }
    val part = tmp.newFile("h.part")
    // First run: the connection drops after 700 bytes of a 2000-byte file.
    server.enqueue(
      MockResponse().setResponseCode(206)
        .setHeader("Content-Range", "bytes 0-1999/2000")
        .setHeader("ETag", "\"v-strong-1\"")
        .setBody(Buffer().write(full.copyOfRange(0, 700))),
    )
    assertThrows(MediaNetworkException::class.java) { runBlocking { transfer.transfer(spec(part)) } }
    assertEquals(700L, part.length())
    assertEquals("\"v-strong-1\"", ResumeValidator.read(part))

    // A new process: nothing in memory, only the files on disk.
    server.enqueue(
      MockResponse().setResponseCode(206)
        .setHeader("Content-Range", "bytes 700-1999/2000")
        .setBody(Buffer().write(full.copyOfRange(700, 2000))),
    )
    runBlocking { ProgressiveTransfer(HttpClient.create(urlPolicy = UrlPolicy.ALLOW_ALL)).transfer(spec(part)) }

    server.takeRequest()
    val resume = server.takeRequest()
    assertEquals("bytes=700-", resume.getHeader("Range"))
    assertEquals("\"v-strong-1\"", resume.getHeader("If-Range"))
    assertArrayEquals(full, part.readBytes())
  }

  @Test fun aWeakEtagIsNeverSentAsIfRangeLastModifiedIsUsedInstead() {
    val part = tmp.newFile("i.part")
    server.enqueue(
      MockResponse().setResponseCode(206)
        .setHeader("Content-Range", "bytes 0-999/1000")
        .setHeader("ETag", "W/\"weak-1\"")
        .setHeader("Last-Modified", "Wed, 21 Oct 2026 07:28:00 GMT")
        .setBody(Buffer().write(ByteArray(300))),
    )
    assertThrows(MediaNetworkException::class.java) { runBlocking { transfer.transfer(spec(part)) } }
    assertEquals("Wed, 21 Oct 2026 07:28:00 GMT", ResumeValidator.read(part))

    server.enqueue(
      MockResponse().setResponseCode(206)
        .setHeader("Content-Range", "bytes 300-999/1000")
        .setBody(Buffer().write(ByteArray(700))),
    )
    runBlocking { transfer.transfer(spec(part)) }
    server.takeRequest()
    assertEquals("Wed, 21 Oct 2026 07:28:00 GMT", server.takeRequest().getHeader("If-Range"))
  }

  @Test fun aChangedResourceRestartsFromZeroAndRecordsItsNewValidator() = runBlocking {
    val part = tmp.newFile("j.part").apply { writeBytes(ByteArray(500) { 1 }) }
    ResumeValidator.write(part, "\"old\"")
    val fresh = ByteArray(900) { 3 }
    // If-Range no longer matches: the server sends the new resource whole.
    server.enqueue(MockResponse().setResponseCode(200).setHeader("ETag", "\"new\"").setBody(Buffer().write(fresh)))

    transfer.transfer(spec(part))

    assertEquals("\"old\"", server.takeRequest().getHeader("If-Range"))
    assertArrayEquals(fresh, part.readBytes())
    assertEquals("\"new\"", ResumeValidator.read(part))
  }

  @Test fun diskWriteReportsAFailedWriteAsStorageNotNetwork() {
    val failure = assertThrows(StorageWriteException::class.java) {
      diskWrite { throw java.io.IOException("write failed: ENOSPC (No space left on device)") }
    }
    assertTrue(failure.message!!.contains("ENOSPC"))
    // Already classified: passes through unchanged.
    val same = StorageWriteException(java.io.IOException("EIO"))
    assertTrue(assertThrows(StorageWriteException::class.java) { diskWrite { throw same } } === same)
  }

  @Test fun finalizeToFileMovesAtomicallyAndRemovesPart() {
    val part = tmp.newFile("g.part").apply { writeBytes("done".toByteArray()) }
    val dest = File(tmp.newFolder("library"), "clip.mp4")

    transfer.finalizeToFile(part, dest)

    assertTrue(dest.exists())
    assertArrayEquals("done".toByteArray(), dest.readBytes())
    assertFalse("the .part must be gone after finalize", part.exists())
  }
}
