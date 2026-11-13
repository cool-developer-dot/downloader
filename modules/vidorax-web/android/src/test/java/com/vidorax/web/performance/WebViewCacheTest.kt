package com.vidorax.web.performance

import android.webkit.WebView
import org.junit.Assert.assertEquals
import org.junit.Assert.assertTrue
import org.junit.Rule
import org.junit.Test
import org.junit.rules.TemporaryFolder
import org.junit.runner.RunWith
import org.robolectric.RobolectricTestRunner
import org.robolectric.RuntimeEnvironment
import org.robolectric.Shadows.shadowOf
import java.io.File

@RunWith(RobolectricTestRunner::class)
class WebViewCacheTest {
  @get:Rule val folder = TemporaryFolder()

  @Test
  fun sizeAddsEveryFileUnderTheWebViewCache() {
    val root = folder.newFolder("WebView")
    File(root, "Default/HTTP Cache").mkdirs()
    File(root, "Default/HTTP Cache/a").writeBytes(ByteArray(1000))
    File(root, "Default/HTTP Cache/b").writeBytes(ByteArray(24))
    File(root, "Profile 1/Code Cache").mkdirs()
    File(root, "Profile 1/Code Cache/c").writeBytes(ByteArray(500))
    assertEquals(1524L, WebViewCache.sizeOf(root))
    assertEquals(0L, WebViewCache.sizeOf(File(folder.root, "missing")))
  }

  @Test
  fun sizeReadsTheAppsOwnCacheFolder() {
    val context = RuntimeEnvironment.getApplication()
    val root = WebViewCache.root(context)
    assertEquals(File(context.cacheDir, "WebView"), root)
    root.mkdirs()
    File(root, "x").writeBytes(ByteArray(10))
    assertEquals(10L, WebViewCache.size(context))
  }

  @Test
  fun clearAsksChromiumToClearDiskCacheAndDestroysItsWebView() {
    val context = RuntimeEnvironment.getApplication()
    val made = mutableListOf<WebView>()
    val cleared = WebViewCache.clear(context) { WebView(it).also(made::add) }
    // Robolectric has no WebView profiles: only the default profile's cache.
    assertEquals(1, cleared)
    assertEquals(1, made.size)
    assertTrue(shadowOf(made[0]).wasClearCacheCalled())
    assertTrue(shadowOf(made[0]).didClearCacheIncludeDiskFiles())
    assertTrue(shadowOf(made[0]).wasDestroyCalled())
  }

  @Test
  fun aWebViewThatCannotBeMadeIsSkipped() {
    val context = RuntimeEnvironment.getApplication()
    assertEquals(0, WebViewCache.clear(context) { throw IllegalStateException("no WebView provider") })
  }
}
