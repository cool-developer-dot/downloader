package com.vidorax.media.net

import com.vidorax.media.model.BasicCredentials
import com.vidorax.media.model.DownloadRecord
import com.vidorax.media.model.DownloadState
import com.vidorax.media.model.SiteId
import com.vidorax.media.model.SourceKind
import java.util.concurrent.Executors
import kotlinx.coroutines.CoroutineScope
import kotlinx.coroutines.asCoroutineDispatcher
import kotlinx.coroutines.cancel
import kotlinx.coroutines.delay
import kotlinx.coroutines.flow.MutableSharedFlow
import kotlinx.coroutines.runBlocking
import kotlinx.coroutines.withTimeout
import okhttp3.HttpUrl.Companion.toHttpUrl
import org.junit.After
import org.junit.Assert.assertEquals
import org.junit.Assert.assertFalse
import org.junit.Assert.assertNull
import org.junit.Assert.assertTrue
import org.junit.Before
import org.junit.Test

/**
 * #299: a download's sign-in is held in memory only, pinned to its https origin, and cleared as the download stops.
 * What survives a restart is only that the download uses sign-in (origin and realm — no secret).
 */
class DownloadCredentialsTest {
  private val alice = BasicCredentials("alice", "s3cret:with colon")

  @Before fun setUp() = DownloadCredentials.resetForTests()

  @After fun tearDown() = DownloadCredentials.resetForTests()

  private fun auth(id: String?, url: String) = DownloadCredentials.authorizationFor(id, url.toHttpUrl())

  @Test fun theHeaderIsRfc7617BasicInUtf8() {
    DownloadCredentials.put("dl", "https://media.example.com/v.mp4", BasicCredentials("Ünïcode", "pässwörd"))
    val expected = "Basic " + java.util.Base64.getEncoder().encodeToString("Ünïcode:pässwörd".toByteArray(Charsets.UTF_8))
    assertEquals(expected, auth("dl", "https://media.example.com/v.mp4"))
  }

  @Test fun onlyTheExactHttpsOriginGetsIt() {
    DownloadCredentials.put("dl", "https://media.example.com/videos/a.mp4?x=1", alice)
    assertTrue(auth("dl", "https://media.example.com/other/path") != null)
    assertTrue("explicit default port is the same origin", auth("dl", "https://media.example.com:443/a") != null)
    assertNull("another port", auth("dl", "https://media.example.com:8443/a"))
    assertNull("another host", auth("dl", "https://cdn.example.com/a"))
    assertNull("a subdomain", auth("dl", "https://x.media.example.com/a"))
    assertNull("a look-alike suffix", auth("dl", "https://media.example.com.evil.test/a"))
    assertNull("plain http to the same host", auth("dl", "http://media.example.com/a"))
    assertNull("another download", auth("other", "https://media.example.com/a"))
    assertNull("no download at all", auth(null, "https://media.example.com/a"))
  }

  @Test fun httpIsRefusedOutright() {
    assertFalse(DownloadCredentials.put("dl", "http://media.example.com/v.mp4", alice))
    assertFalse(DownloadCredentials.has("dl"))
    assertFalse("nothing is remembered either", DownloadCredentials.usesSignIn("dl"))
    assertNull(auth("dl", "http://media.example.com/v.mp4"))
    assertFalse(DownloadCredentials.put("dl", "not a url", alice))
    assertTrue(DownloadCredentials.put("dl", "https://media.example.com/v.mp4", alice))
  }

  @Test fun noSecretIsEverPrinted() {
    DownloadCredentials.put("dl", "https://media.example.com/v.mp4", alice)
    assertFalse(alice.toString().contains("alice"))
    assertFalse(alice.toString().contains("s3cret"))
    val signIn = DownloadCredentials.neededFor("dl")
    assertNull("credentials in memory: nothing to ask", signIn)
  }

  @Test fun afterAProcessDeathOnlyTheMarkRemainsAndRestoreIsPinnedToTheOriginalOrigin() {
    val flags = DownloadCredentials.Flags.memory()
    DownloadCredentials.resetForTests(flags)
    DownloadCredentials.put("dl", "https://media.example.com/v.mp4", alice, realm = "Home NAS")

    // A new process: memory is gone, the mark (no secret) is what was saved.
    DownloadCredentials.resetForTests(flags)
    assertFalse(DownloadCredentials.has("dl"))
    assertTrue(DownloadCredentials.usesSignIn("dl"))
    assertEquals(DownloadCredentials.SignIn("https://media.example.com:443", "Home NAS"), DownloadCredentials.neededFor("dl"))

    assertTrue(DownloadCredentials.restore("dl", alice))
    assertTrue(auth("dl", "https://media.example.com/v.mp4") != null)
    assertNull(auth("dl", "https://elsewhere.example/v.mp4"))
    assertNull(DownloadCredentials.neededFor("dl"))

    assertFalse("a download that never used sign-in gets nothing", DownloadCredentials.restore("plain", alice))
    assertNull(auth("plain", "https://media.example.com/v.mp4"))
  }

  @Test fun theyAreClearedWhenTheDownloadStops() = runBlocking {
    val flags = DownloadCredentials.Flags.memory()
    DownloadCredentials.resetForTests(flags)
    val states = MutableSharedFlow<DownloadRecord>(extraBufferCapacity = 16)
    val pool = Executors.newSingleThreadExecutor().asCoroutineDispatcher()
    val scope = CoroutineScope(pool)
    try {
      DownloadCredentials.install(flags, states, scope)
      delay(50) // the collector subscribes
      for (id in listOf("done", "cancelled", "failed", "running")) {
        DownloadCredentials.put(id, "https://media.example.com/$id.mp4", alice)
      }
      states.emit(record("done", DownloadState.COMPLETED))
      states.emit(record("cancelled", DownloadState.CANCELLED))
      states.emit(record("failed", DownloadState.FAILED))
      states.emit(record("running", DownloadState.DOWNLOADING))
      withTimeout(2_000) {
        while (DownloadCredentials.has("done") || DownloadCredentials.has("cancelled") || DownloadCredentials.has("failed")) {
          delay(10)
        }
      }
      assertFalse(DownloadCredentials.usesSignIn("done"))
      assertFalse(DownloadCredentials.usesSignIn("cancelled"))
      assertTrue("a failed one asks again on Retry", DownloadCredentials.usesSignIn("failed"))
      assertTrue(DownloadCredentials.neededFor("failed") != null)
      assertTrue("a running one keeps them", DownloadCredentials.has("running"))
    } finally {
      scope.cancel()
      pool.close()
    }
  }

  private fun record(id: String, state: DownloadState) = DownloadRecord(
    id = id,
    state = state,
    title = id,
    site = SiteId.WEB,
    kind = SourceKind.PROGRESSIVE,
    pageUrl = null,
    thumbnailUrl = null,
    qualityLabel = null,
    bytesDone = 0,
    totalBytes = null,
    errorCode = null,
    errorMessage = null,
    attempts = 0,
    libraryItemId = null,
    createdAt = 0,
    updatedAt = 0,
  )
}
