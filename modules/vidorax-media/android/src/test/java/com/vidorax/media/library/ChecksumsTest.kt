package com.vidorax.media.library

import com.vidorax.media.NotFoundException
import java.io.File
import java.util.Collections
import java.util.concurrent.ConcurrentHashMap
import java.util.concurrent.Executors
import java.util.concurrent.atomic.AtomicInteger
import kotlinx.coroutines.CompletableDeferred
import kotlinx.coroutines.CoroutineScope
import kotlinx.coroutines.SupervisorJob
import kotlinx.coroutines.async
import kotlinx.coroutines.asCoroutineDispatcher
import kotlinx.coroutines.delay
import kotlinx.coroutines.runBlocking
import kotlinx.coroutines.withTimeout
import org.junit.After
import org.junit.Assert.assertEquals
import org.junit.Assert.assertFalse
import org.junit.Assert.assertNull
import org.junit.Assert.assertThrows
import org.junit.Assert.assertTrue
import org.junit.Before
import org.junit.Rule
import org.junit.Test
import org.junit.rules.TemporaryFolder

/** H20 Checksum Verify (#409): the stored hash is used when there is one; otherwise it is streamed once and stored. */
class ChecksumsTest {
  @get:Rule val tmp = TemporaryFolder()

  private val pool = Executors.newFixedThreadPool(2).asCoroutineDispatcher()
  private val scope = CoroutineScope(SupervisorJob() + pool)
  private val stored = ConcurrentHashMap<String, String>()
  private val stores = Collections.synchronizedList(mutableListOf<Pair<String, String>>())
  private val fileLookups = AtomicInteger(0)
  private val files = ConcurrentHashMap<String, File>()

  @Volatile private var gate: CompletableDeferred<Unit>? = null

  /** After the first read, reads wait until this is released (a slow disk the test controls). */
  private val slowReads = java.util.concurrent.CountDownLatch(1)
  @Volatile private var slow = false

  private lateinit var checksums: Checksums

  @Before fun setUp() {
    checksums = Checksums(
      scope = scope,
      fileOf = { id ->
        fileLookups.incrementAndGet()
        gate?.await()
        files[id]
      },
      storedHashOf = { stored[it] },
      storeHash = { id, hash ->
        stores += id to hash
        stored[id] = hash
      },
      open = { file ->
        val inner = file.inputStream()
        object : java.io.InputStream() {
          private var reads = 0

          override fun read(): Int = inner.read()

          override fun read(b: ByteArray, off: Int, len: Int): Int {
            if (slow && reads++ > 0) slowReads.await(5, java.util.concurrent.TimeUnit.SECONDS)
            return inner.read(b, off, len)
          }

          override fun close() = inner.close()
        }
      },
    )
  }

  @After fun tearDown() = pool.close()

  private fun file(id: String, size: Int): File =
    tmp.newFile("$id.mp4").apply { writeBytes(ByteArray(size) { (it % 251).toByte() }) }.also { files[id] = it }

  @Test fun theStoredHashOfTheDuplicateCheckIsUsedAsItIs() = runBlocking {
    val known = "a".repeat(64)
    stored["v1"] = known
    assertEquals(known, checksums.cached("v1"))
    assertEquals(known, checksums.compute("v1"))
    assertEquals("the file is never read", 0, fileLookups.get())
    assertTrue(stores.isEmpty())
  }

  @Test fun aMissingHashIsStreamedOnceStoredAndThenReused() = runBlocking {
    val f = file("v1", 3 * 1024 * 1024 + 17)
    assertNull(checksums.cached("v1"))
    val first = checksums.compute("v1")
    assertEquals(ContentHash.sha256(f), first)
    assertEquals(listOf("v1" to first), stores.toList())

    val again = checksums.compute("v1")
    assertEquals(first, again)
    assertEquals("cached: no second read", 1, fileLookups.get())
    assertEquals(1, stores.size)
    assertEquals(first, checksums.cached("v1"))
  }

  @Test fun aStoredValueThatIsNotAHashIsIgnored() = runBlocking {
    stored["v1"] = "not-a-hash"
    assertNull(checksums.cached("v1"))
    file("v1", 10)
    assertTrue(Checksums.isSha256(checksums.compute("v1")))
  }

  @Test fun progressIsReportedWhileItRunsAndCancelStopsItWithoutStoringAnything() = runBlocking {
    file("big", 4 * 1024 * 1024)
    slow = true
    val result = async { checksums.compute("big") }
    // The first 1 MiB is read, then the "disk" holds the next read.
    withTimeout(5_000) { while ((checksums.progress("big")?.bytesDone ?: 0L) < 1024 * 1024) delay(5) }
    assertTrue(checksums.isComputing("big"))
    val progress = checksums.progress("big")!!
    assertEquals(4L * 1024 * 1024, progress.totalBytes)
    assertEquals(1024L * 1024, progress.bytesDone)

    checksums.cancel("big")
    slowReads.countDown()
    assertNull("cancelled: no hash, no error", withTimeout(5_000) { result.await() })
    assertTrue(stores.isEmpty())
    assertNull(checksums.progress("big"))
    assertFalse(checksums.isComputing("big"))
  }

  @Test fun aSecondComputeWhileOneRunsJoinsIt() = runBlocking {
    file("v1", 8 * 1024 * 1024)
    gate = CompletableDeferred()
    val a = async { checksums.compute("v1") }
    val b = async { checksums.compute("v1") }
    delay(100)
    gate!!.complete(Unit)
    val first = withTimeout(5_000) { a.await() }
    val second = withTimeout(5_000) { b.await() }
    assertEquals(first, second)
    assertTrue(stores.size <= 2)
    assertTrue(stores.all { it.second == first })
  }

  @Test fun aGoneItemOrFileIsNotFound() = runBlocking<Unit> {
    assertThrows(NotFoundException::class.java) { runBlocking { checksums.compute("nope") } }
    files["gone"] = File(tmp.root, "gone.mp4")
    assertThrows(NotFoundException::class.java) { runBlocking { checksums.compute("gone") } }
  }

  @Test fun theStreamingDigestEqualsTheDuplicateChecksOne() = runBlocking {
    val f = file("v1", 2 * 1024 * 1024 + 3)
    val seen = mutableListOf<Long>()
    val hex = f.inputStream().use { Checksums.sha256(it) { seen += it } }
    assertEquals(ContentHash.sha256(f), hex)
    assertEquals(f.length(), seen.last())
    assertEquals(seen, seen.sorted())
  }
}
