package com.vidorax.media.incoming

import android.content.Intent
import android.net.Uri
import org.junit.Assert.assertEquals
import org.junit.Assert.assertFalse
import org.junit.Assert.assertNotEquals
import org.junit.Assert.assertNull
import org.junit.Assert.assertTrue
import org.junit.Test
import org.junit.runner.RunWith
import org.robolectric.RobolectricTestRunner
import org.robolectric.RuntimeEnvironment

/** Which intents are a file to open in the player, and what JavaScript gets for them. */
@RunWith(RobolectricTestRunner::class)
class IncomingMediaIntentsTest {
  private val content = Uri.parse("content://com.android.providers.downloads.documents/document/42")
  private val file = Uri.parse("file:///sdcard/Download/clip.mp4")

  @Test fun `a content uri with a video type is a video`() {
    val candidate = IncomingMediaIntents.parse(Intent.ACTION_VIEW, content, "video/mp4", null, "clip.mp4")!!
    assertEquals(IncomingMedia.Kind.VIDEO, candidate.kind)
    assertEquals("video/mp4", candidate.mimeType)
    assertEquals(content, candidate.uri)
  }

  @Test fun `a file uri is accepted and an audio type is audio`() {
    val candidate = IncomingMediaIntents.parse(Intent.ACTION_VIEW, Uri.parse("file:///sdcard/Music/a.mp3"), "audio/mpeg", null, null)!!
    assertEquals(IncomingMedia.Kind.AUDIO, candidate.kind)
    assertEquals(IncomingMedia.Kind.VIDEO, IncomingMediaIntents.parse(Intent.ACTION_VIEW, file, null, null, null)!!.kind)
  }

  @Test fun `web links, intents without data and other actions are not files`() {
    assertNull(IncomingMediaIntents.parse(Intent.ACTION_VIEW, Uri.parse("https://example.com/v.mp4"), "video/mp4", null, null))
    assertNull(IncomingMediaIntents.parse(Intent.ACTION_VIEW, Uri.parse("http://example.com/v.mp4"), "video/mp4", null, null))
    assertNull(IncomingMediaIntents.parse(Intent.ACTION_VIEW, null, "video/mp4", null, null))
    assertNull(IncomingMediaIntents.parse(Intent.ACTION_SEND, content, "video/mp4", null, null))
    assertNull(IncomingMediaIntents.parse(Intent.ACTION_MAIN, null, null, null, null))
    assertNull(IncomingMediaIntents.parse(Intent.ACTION_VIEW, Uri.parse("vidorax://downloads"), null, null, null))
  }

  @Test fun `an unknown type falls back to the resolver's type, then to the name`() {
    // Many file managers send application/octet-stream for .mkv.
    val byName = IncomingMediaIntents.parse(Intent.ACTION_VIEW, content, "application/octet-stream", null, "film.mkv")!!
    assertEquals("video/x-matroska", byName.mimeType)
    val byResolver = IncomingMediaIntents.parse(Intent.ACTION_VIEW, content, null, "video/webm", null)!!
    assertEquals("video/webm", byResolver.mimeType)
    val byUriName = IncomingMediaIntents.parse(Intent.ACTION_VIEW, file, null, null, null)!!
    assertEquals("video/mp4", byUriName.mimeType)
  }

  @Test fun `nothing that says audio or video is not a file to play`() {
    assertNull(IncomingMediaIntents.parse(Intent.ACTION_VIEW, content, "application/pdf", null, "doc.pdf"))
    assertNull(IncomingMediaIntents.parse(Intent.ACTION_VIEW, content, null, null, null))
    assertNull(IncomingMediaIntents.parse(Intent.ACTION_VIEW, content, "image/jpeg", "image/jpeg", "photo.jpg"))
  }

  @Test fun `the token is stable for a uri, differs between uris and reveals nothing`() {
    val token = IncomingMediaIntents.tokenFor(content)
    assertEquals(token, IncomingMediaIntents.tokenFor(Uri.parse(content.toString())))
    assertNotEquals(token, IncomingMediaIntents.tokenFor(file))
    assertEquals(32, token.length)
    assertTrue(IncomingMediaIntents.isToken(token))
    assertFalse(token.contains("42"))
    assertFalse(IncomingMediaIntents.isToken("../../etc"))
    assertFalse(IncomingMediaIntents.isToken(token.uppercase()))
    assertFalse(IncomingMediaIntents.isToken(token + "0"))
  }

  @Test fun `the reader takes a file once per intent and ignores web links`() {
    val reader = IncomingMediaReader(RuntimeEnvironment.getApplication().contentResolver)
    val intent = Intent(Intent.ACTION_VIEW).setDataAndType(file, "video/mp4")
    val media = reader.take(intent)!!
    assertEquals("clip.mp4", media.displayName)
    assertEquals(IncomingMediaIntents.tokenFor(file), media.token)
    assertNull("a JavaScript reload must not reopen it", reader.take(intent))
    assertNull(reader.take(Intent(Intent.ACTION_VIEW, Uri.parse("https://example.com/"))))
    assertNull(reader.take(null))
  }

  @Test fun `the registry keeps the latest files`() {
    val registry = IncomingMediaRegistry(capacity = 2)
    fun media(n: Int) = IncomingMedia("t$n", Uri.parse("content://x/$n"), null, "video/mp4", null, IncomingMedia.Kind.VIDEO)
    registry.put(media(1))
    registry.put(media(2))
    registry.put(media(3))
    assertNull(registry.get("t1"))
    assertEquals("content://x/3", registry.get("t3")!!.uri.toString())
  }
}
