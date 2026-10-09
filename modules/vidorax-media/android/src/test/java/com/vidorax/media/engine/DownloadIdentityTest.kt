package com.vidorax.media.engine

import com.vidorax.media.model.VariantChoice
import org.junit.Assert.assertEquals
import org.junit.Assert.assertFalse
import org.junit.Assert.assertNotEquals
import org.junit.Assert.assertNull
import org.junit.Assert.assertTrue
import org.junit.Test

class DownloadIdentityTest {
  private fun id(url: String, page: String? = null, variant: VariantChoice? = null) = DownloadIdentity.of(url, variant, page)

  @Test fun theSameFileReSignedIsTheSameVideo() {
    val page = "https://www.instagram.com/reel/Cx1/"
    val first = id("https://scontent.cdninstagram.com/v/t50/123_n.mp4?efg=abc&oh=00_AAA&oe=65F0", page)
    val later = id("https://scontent.cdninstagram.com/v/t50/123_n.mp4?oe=6600&efg=abc&oh=00_BBB", page)
    assertEquals(first, later)
  }

  @Test fun hostCaseWwwFragmentAndFieldOrderDoNotMatter() {
    assertEquals(
      id("https://www.Example.com/media/clip.mp4?b=2&a=1#t=3"),
      id("https://example.com/media/clip.mp4?a=1&b=2"),
    )
  }

  @Test fun differentVideosWithTheSameFileNameAreDifferent() {
    assertNotEquals(id("https://cdn.example/users/1/video.mp4"), id("https://cdn.example/users/2/video.mp4"))
    assertNotEquals(id("https://a.example/video.mp4"), id("https://b.example/video.mp4"))
    assertNotEquals(id("https://cdn.example/watch?v=1"), id("https://cdn.example/watch?v=2"))
  }

  @Test fun aGenericSignedPathIsTiedToThePageThatOfferedIt() {
    // The token is the only thing that tells these files apart: the page must, too.
    val a = id("https://cdn.example/stream?token=aaa", page = "https://site.example/videos/1")
    val b = id("https://cdn.example/stream?token=bbb", page = "https://site.example/videos/2")
    assertNotEquals(a, b)
    // …while the same page re-signing its link, or sharing it with tracking fields, is still one video.
    assertEquals(a, id("https://cdn.example/stream?token=ccc", page = "https://site.example/videos/1?utm_source=x"))
  }

  @Test fun anUnsignedLinkIsTheSameVideoOnAnyPage() {
    assertEquals(
      id("https://cdn.example/files/42.mp4", page = "https://blog.example/post-a"),
      id("https://cdn.example/files/42.mp4", page = "https://blog.example/post-b"),
    )
  }

  @Test fun anotherQualityOfTheSameStreamIsAnotherFile() {
    val master = "https://cdn.example/hls/master.m3u8"
    val p720 = VariantChoice("https://cdn.example/hls/720.m3u8?sig=1", null, null)
    val p720resigned = VariantChoice("https://cdn.example/hls/720.m3u8?sig=2", null, null)
    val p1080 = VariantChoice("https://cdn.example/hls/1080.m3u8", null, null)
    assertEquals(id(master, variant = p720), id(master, variant = p720resigned))
    assertNotEquals(id(master, variant = p720), id(master, variant = p1080))
    assertNotEquals(id(master, variant = VariantChoice(null, null, 720)), id(master, variant = VariantChoice(null, null, 1080)))
    assertNotEquals(id(master), id(master, variant = p720))
  }

  @Test fun theKeyIsAHashNeverTheLink() {
    val key = id("https://cdn.example/secret-path/clip.mp4?token=abc")!!
    assertTrue(key.matches(Regex("[0-9a-f]{64}")))
    assertFalse(key.contains("secret"))
  }

  @Test fun somethingThatIsNotAWebLinkHasNoIdentity() {
    assertNull(id("blob:https://site.example/1234"))
    assertNull(id("not a url"))
  }
}
