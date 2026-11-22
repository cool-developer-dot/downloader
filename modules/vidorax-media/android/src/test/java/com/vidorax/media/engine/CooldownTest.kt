package com.vidorax.media.engine

import com.vidorax.media.model.DownloadSettings
import com.vidorax.media.model.LowMemoryMode
import kotlinx.coroutines.runBlocking
import org.junit.Assert.assertEquals
import org.junit.Assert.assertNull
import org.junit.Assert.assertTrue
import org.junit.Test

/** #506 Cooldown between files and #348 Low memory mode. */
class CooldownTest {
  @Test fun sitesAreComparedByHostWithoutWww() {
    assertEquals("example.com", Cooldown.siteOf("https://www.Example.com/a.mp4"))
    assertEquals("cdn.example.com", Cooldown.siteOf("https://cdn.example.com/b.mp4?x=1"))
    assertNull(Cooldown.siteOf("not a url"))
  }

  @Test fun aSitesNextDownloadWaitsOutTheCooldownAfterItsLastOneEnded() = runBlocking {
    var clock = 10_000L
    val cooldown = Cooldown { clock }
    cooldown.ended("example.com")
    clock += 400
    val started = System.nanoTime()
    cooldown.await("example.com", seconds = 1)
    val waitedMs = (System.nanoTime() - started) / 1_000_000
    assertTrue("waited about 600 ms, was $waitedMs", waitedMs in 500..1_500)
  }

  @Test fun otherSitesAndNoCooldownDoNotWait() = runBlocking {
    val cooldown = Cooldown { 0L }
    cooldown.ended("example.com")
    val started = System.nanoTime()
    cooldown.await("other.org", seconds = 60)
    cooldown.await("example.com", seconds = 0)
    cooldown.await(null, seconds = 60)
    assertTrue((System.nanoTime() - started) / 1_000_000 < 200)
  }

  @Test fun lowMemoryModeRunsOneDownloadOnOneConnectionWithASmallBuffer() {
    val chosen = DownloadSettings.DEFAULT.copy(maxConcurrent = 3, connectionsPerFile = 4, bufferKb = 512, writeCacheKb = 4096)
    val on = chosen.copy(lowMemoryMode = LowMemoryMode.ON).effective(lowRamDevice = false)
    assertEquals(1, on.maxConcurrent)
    assertEquals(1, on.connectionsPerFile)
    assertEquals(DownloadSettings.LOW_MEMORY_BUFFER_KB, on.bufferKb)
    assertEquals(0, on.writeCacheKb)
    assertEquals("automatic follows the device", 1, chosen.effective(lowRamDevice = true).maxConcurrent)
    assertEquals(chosen, chosen.effective(lowRamDevice = false))
    assertEquals("off ignores the device", chosen.copy(lowMemoryMode = LowMemoryMode.OFF), chosen.copy(lowMemoryMode = LowMemoryMode.OFF).effective(lowRamDevice = true))
  }
}
