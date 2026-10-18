package com.vidorax.media.bridge

import com.vidorax.media.InvalidRequestException
import org.junit.Assert.assertEquals
import org.junit.Assert.assertFalse
import org.junit.Assert.assertNull
import org.junit.Assert.assertThrows
import org.junit.Test

/** #299: credentials from JavaScript are checked before anything holds them, and never printed. */
class CredentialsRecordTest {
  private fun enqueue(url: String, credentials: CredentialsRecord?) =
    EnqueueRequestRecord(url = url, kind = "progressive", title = "Clip", site = "web", credentials = credentials)

  @Test fun validCredentialsForAnHttpsLinkRideWithTheRequest() {
    val model = enqueue("https://nas.example.com/v.mp4", CredentialsRecord("alice", "p:a ss")).toModel()
    assertEquals("alice", model.credentials?.username)
    assertEquals("p:a ss", model.credentials?.password)
    assertNull(enqueue("https://nas.example.com/v.mp4", null).toModel().credentials)
  }

  @Test fun anHttpLinkIsRefused() {
    val error = assertThrows(InvalidRequestException::class.java) {
      enqueue("http://nas.example.com/v.mp4", CredentialsRecord("alice", "pw")).toModel()
    }
    assertFalse("no secret in the message", error.message.orEmpty().contains("pw"))
  }

  @Test fun invalidValuesAreRefusedWithoutEchoingThem() {
    val bad = listOf(
      CredentialsRecord("", "pw"),
      CredentialsRecord("al:ice", "pw"),
      CredentialsRecord("x".repeat(257), "pw"),
      CredentialsRecord("alice", "y".repeat(257)),
      CredentialsRecord("ali\nce", "pw"),
      CredentialsRecord("alice", "p\u0000w"),
    )
    for (record in bad) {
      val error = assertThrows(InvalidRequestException::class.java) {
        enqueue("https://nas.example.com/v.mp4", record).toModel()
      }
      assertFalse(error.message.orEmpty().contains("alice"))
      assertFalse(error.message.orEmpty().contains("pw"))
    }
  }

  @Test fun neitherTheRecordNorTheRequestPrintsTheSecret() {
    val record = CredentialsRecord("alice", "s3cret")
    assertFalse(record.toString().contains("s3cret"))
    val request = enqueue("https://nas.example.com/v.mp4", record)
    assertFalse("the enqueue record is a data class: its credentials print redacted", request.toString().contains("s3cret"))
    assertFalse(request.toModel().toString().contains("s3cret"))
  }
}
