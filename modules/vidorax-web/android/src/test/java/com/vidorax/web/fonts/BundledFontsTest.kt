package com.vidorax.web.fonts

import android.net.Uri
import java.io.ByteArrayInputStream
import org.junit.Assert.assertArrayEquals
import org.junit.Assert.assertEquals
import org.junit.Assert.assertNotNull
import org.junit.Assert.assertNull
import org.junit.Assert.assertTrue
import org.junit.Test
import org.junit.runner.RunWith
import org.robolectric.RobolectricTestRunner

@RunWith(RobolectricTestRunner::class)
class BundledFontsTest {
  private val fontBytes = byteArrayOf(0, 1, 0, 0, 7, 7)
  private val opened = mutableListOf<Int>()
  private val fonts = BundledFonts {
    opened += 1
    ByteArrayInputStream(fontBytes)
  }

  @Test
  fun servesTheOneFontWithCors() {
    val response = fonts.intercept(Uri.parse(BundledFonts.FONT_URL), "GET")
    assertNotNull(response)
    assertEquals(200, response!!.statusCode)
    assertEquals("font/ttf", response.mimeType)
    assertEquals("*", response.responseHeaders["Access-Control-Allow-Origin"])
    assertArrayEquals(fontBytes, response.data.readBytes())
    assertEquals(1, opened.size)
    assertEquals("https://appassets.androidplatform.net/vidorax-fonts/NotoNastaliqUrdu-Regular.ttf", BundledFonts.FONT_URL)
    assertEquals("vidorax-fonts/NotoNastaliqUrdu-Regular.ttf", BundledFonts.ASSET_PATH)
  }

  @Test
  fun everyOtherPathOnTheHostGetsAnEmpty404AndOpensNothing() {
    val others = listOf(
      "https://appassets.androidplatform.net/vidorax-fonts/NotoNastaliqUrdu-OFL.txt",
      "https://appassets.androidplatform.net/index.android.bundle",
      "https://appassets.androidplatform.net/assets/index.android.bundle",
      "https://appassets.androidplatform.net/vidorax-fonts/../index.android.bundle",
      "https://appassets.androidplatform.net/vidorax-fonts/%2e%2e/index.android.bundle",
      "https://appassets.androidplatform.net/vidorax-fonts/notonastaliqurdu-regular.ttf",
      "https://appassets.androidplatform.net/vidorax-fonts/",
      "https://appassets.androidplatform.net/vidorax-fonts/NotoNastaliqUrdu-Regular.ttf/x",
      "https://appassets.androidplatform.net/res/raw/anything",
      "https://appassets.androidplatform.net/",
      "https://APPASSETS.androidplatform.net/fonts/x.ttf",
      // The right path, but not over https.
      "http://appassets.androidplatform.net/vidorax-fonts/NotoNastaliqUrdu-Regular.ttf",
    )
    for (url in others) {
      val response = fonts.intercept(Uri.parse(url), "GET")
      assertNotNull(url, response)
      assertEquals(url, 404, response!!.statusCode)
      assertEquals(url, 0, response.data.readBytes().size)
    }
    assertTrue("no asset opened for any other path", opened.isEmpty())
  }

  @Test
  fun onlyGetIsServed() {
    val response = fonts.intercept(Uri.parse(BundledFonts.FONT_URL), "POST")
    assertEquals(404, response!!.statusCode)
    assertTrue(opened.isEmpty())
  }

  @Test
  fun otherHostsAreNotTouched() {
    assertNull(fonts.intercept(Uri.parse("https://fonts.gstatic.com/s/notonastaliqurdu/v1/x.ttf"), "GET"))
    assertNull(fonts.intercept(Uri.parse("https://example.com/vidorax-fonts/NotoNastaliqUrdu-Regular.ttf"), "GET"))
    assertNull(fonts.intercept(Uri.parse("https://appassets.androidplatform.net.evil.example/vidorax-fonts/NotoNastaliqUrdu-Regular.ttf"), "GET"))
    assertTrue(opened.isEmpty())
  }

  @Test
  fun theServedAssetShipsInTheModule() {
    // Gradle runs unit tests in the module directory; the asset is what ASSET_PATH opens through AssetManager.
    val asset = java.io.File("src/main/assets/${BundledFonts.ASSET_PATH}")
    assertTrue(asset.path, asset.isFile)
    assertEquals(690_304L, asset.length())
  }

  @Test
  fun aMissingAssetIsA404NotACrash() {
    val broken = BundledFonts { throw java.io.FileNotFoundException("gone") }
    assertEquals(404, broken.intercept(Uri.parse(BundledFonts.FONT_URL), "GET")!!.statusCode)
  }
}
