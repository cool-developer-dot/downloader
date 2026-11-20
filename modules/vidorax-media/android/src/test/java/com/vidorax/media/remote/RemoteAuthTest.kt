package com.vidorax.media.remote

import org.junit.Assert.assertEquals
import org.junit.Assert.assertFalse
import org.junit.Assert.assertNotEquals
import org.junit.Assert.assertNotNull
import org.junit.Assert.assertNull
import org.junit.Assert.assertTrue
import org.junit.Test

/** P6 pairing: PIN, lockout after wrong PINs, token issue and checks. */
class RemoteAuthTest {
  private var now = 1_000_000L
  private val storage = InMemoryPairedClientStorage()
  private val auth = RemoteAuth(storage, clock = { now })

  private fun wrongPin(pin: String): String = if (pin == "000000") "111111" else "000000"

  @Test
  fun pinIsSixDigitsAndPairingIssuesAToken() {
    val pin = auth.newPin()
    assertTrue(Regex("^\\d{6}$").matches(pin))
    val result = auth.pair(pin, "Chrome on Mac") as RemoteAuth.PairResult.Paired
    assertEquals(43, result.token.length)
    assertEquals("Chrome on Mac", result.client.name)
    assertEquals(result.client.id, auth.authenticate(result.token)?.id)
  }

  @Test
  fun onlyTheTokenHashIsStored() {
    val result = auth.pair(auth.newPin(), "CLI") as RemoteAuth.PairResult.Paired
    val stored = storage.saved.single()
    assertEquals(RemoteAuth.hash(result.token), stored.tokenHash)
    assertNotEquals(result.token, stored.tokenHash)
    assertFalse(stored.toString().contains(result.token))
  }

  @Test
  fun unknownMalformedAndMissingTokensAreRefused() {
    auth.pair(auth.newPin(), "A")
    assertNull(auth.authenticate(null))
    assertNull(auth.authenticate(""))
    assertNull(auth.authenticate("short"))
    assertNull(auth.authenticate("A".repeat(43)))
    assertNull(auth.authenticate("../../" + "a".repeat(37)))
  }

  @Test
  fun noPinMeansPairingIsClosed() {
    assertEquals(RemoteAuth.PairResult.Closed, auth.pair("123456", "A"))
    val pin = auth.newPin()
    auth.closePairing()
    assertEquals(RemoteAuth.PairResult.Closed, auth.pair(pin, "A"))
  }

  @Test
  fun fiveWrongPinsLockPairingAndTheRightPinWaits() {
    val pin = auth.newPin()
    repeat(4) { index ->
      val result = auth.pair(wrongPin(pin), "A") as RemoteAuth.PairResult.WrongPin
      assertEquals(RemoteAuth.ATTEMPTS_PER_LOCK - index - 1, result.attemptsLeft)
    }
    val locked = auth.pair(wrongPin(pin), "A") as RemoteAuth.PairResult.Locked
    assertEquals(RemoteAuth.BASE_LOCK_MS, locked.retryAfterMs)
    // Even the right PIN is refused while locked.
    assertTrue(auth.pair(pin, "A") is RemoteAuth.PairResult.Locked)
    assertNotNull(auth.pinState().lockedUntil)
    now += RemoteAuth.BASE_LOCK_MS
    assertNull(auth.pinState().lockedUntil)
    assertTrue(auth.pair(pin, "A") is RemoteAuth.PairResult.Paired)
  }

  @Test
  fun eachFurtherLockLastsTwiceAsLong() {
    val pin = auth.newPin()
    repeat(5) { auth.pair(wrongPin(pin), "A") }
    now += RemoteAuth.BASE_LOCK_MS
    repeat(4) { auth.pair(wrongPin(pin), "A") }
    val second = auth.pair(wrongPin(pin), "A") as RemoteAuth.PairResult.Locked
    assertEquals(RemoteAuth.BASE_LOCK_MS * 2, second.retryAfterMs)
  }

  @Test
  fun fifteenWrongPinsWithdrawThePinUntilANewOne() {
    val pin = auth.newPin()
    var results = mutableListOf<RemoteAuth.PairResult>()
    repeat(RemoteAuth.MAX_FAILURES_PER_PIN) {
      results += auth.pair(wrongPin(pin), "A")
      now += RemoteAuth.MAX_LOCK_MS
    }
    assertEquals(RemoteAuth.PairResult.Closed, results.last())
    assertTrue(auth.pinState().closedByFailures)
    assertNull(auth.pinState().pin)
    assertEquals(RemoteAuth.PairResult.Closed, auth.pair(pin, "A"))
    val fresh = auth.newPin()
    assertFalse(auth.pinState().closedByFailures)
    assertTrue(auth.pair(fresh, "A") is RemoteAuth.PairResult.Paired)
  }

  @Test
  fun aNewPinLiftsTheLock() {
    val pin = auth.newPin()
    repeat(5) { auth.pair(wrongPin(pin), "A") }
    val fresh = auth.newPin()
    assertTrue(auth.pair(fresh, "A") is RemoteAuth.PairResult.Paired)
  }

  @Test
  fun forgetRevokesAToken() {
    val result = auth.pair(auth.newPin(), "A") as RemoteAuth.PairResult.Paired
    assertTrue(auth.forget(result.client.id))
    assertNull(auth.authenticate(result.token))
    val other = auth.pair(auth.newPin(), "B") as RemoteAuth.PairResult.Paired
    auth.forgetAll()
    assertNull(auth.authenticate(other.token))
    assertTrue(storage.saved.isEmpty())
  }

  @Test
  fun tokensSurviveARestartThroughStorage() {
    val result = auth.pair(auth.newPin(), "A") as RemoteAuth.PairResult.Paired
    val restarted = RemoteAuth(storage, clock = { now })
    assertEquals(result.client.id, restarted.authenticate(result.token)?.id)
  }

  @Test
  fun unusedClientsExpire() {
    val result = auth.pair(auth.newPin(), "A") as RemoteAuth.PairResult.Paired
    now += RemoteAuth.CLIENT_EXPIRY_MS + 1
    assertNull(auth.authenticate(result.token))
    assertTrue(auth.clients().isEmpty())
  }

  @Test
  fun atMostTenClientsTheLeastRecentlySeenGoesFirst() {
    val pin = auth.newPin()
    val tokens = (1..RemoteAuth.MAX_CLIENTS).map {
      now += 1000
      (auth.pair(pin, "C$it") as RemoteAuth.PairResult.Paired).token
    }
    now += 1000
    auth.pair(pin, "Newest")
    assertEquals(RemoteAuth.MAX_CLIENTS, auth.clients().size)
    assertNull(auth.authenticate(tokens.first()))
    assertNotNull(auth.authenticate(tokens.last()))
  }

  @Test
  fun seenTimesAreSavedAtMostOnceAMinute() {
    val result = auth.pair(auth.newPin(), "A") as RemoteAuth.PairResult.Paired
    val saves = storage.saves
    repeat(10) {
      now += 1000
      auth.authenticate(result.token)
    }
    assertEquals(saves, storage.saves)
    now += RemoteAuth.SEEN_SAVE_INTERVAL_MS
    auth.authenticate(result.token)
    assertEquals(saves + 1, storage.saves)
  }

  @Test
  fun namesArePrintableAndShort() {
    assertEquals("Browser", RemoteAuth.cleanName("  \u0000\n "))
    assertEquals("ab", RemoteAuth.cleanName("a\u0007b"))
    assertEquals(RemoteAuth.MAX_NAME_LENGTH, RemoteAuth.cleanName("x".repeat(500)).length)
  }

  @Test
  fun changesAreReported() {
    var changes = 0
    auth.onChange = { changes += 1 }
    val pin = auth.newPin()
    auth.pair(wrongPin(pin), "A")
    auth.pair(pin, "A")
    assertEquals(3, changes)
  }
}
