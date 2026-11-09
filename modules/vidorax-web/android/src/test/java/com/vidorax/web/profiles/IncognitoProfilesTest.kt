package com.vidorax.web.profiles

import android.webkit.CookieManager
import android.webkit.WebView
import com.facebook.react.bridge.JavaOnlyMap
import com.facebook.react.uimanager.ReactStylesDiffMap
import com.reactnativecommunity.webview.RNCWebView
import com.reactnativecommunity.webview.RNCWebViewHooks
import org.junit.After
import org.junit.Assert.assertEquals
import org.junit.Assert.assertFalse
import org.junit.Assert.assertNull
import org.junit.Assert.assertSame
import org.junit.Assert.assertTrue
import org.junit.Test
import org.junit.runner.RunWith
import org.robolectric.RobolectricTestRunner
import org.robolectric.RuntimeEnvironment

@RunWith(RobolectricTestRunner::class)
class IncognitoProfilesTest {
  private val jar: CookieManager = CookieManager.getInstance()
  private val joined = mutableListOf<Pair<WebView, String>>()
  private val join: (WebView, String) -> Unit = { view, name -> joined += view to name }

  @After
  fun tearDown() {
    IncognitoProfiles.resetForTests()
  }

  @Test
  fun onlySessionNamesAreIncognito() {
    assertTrue(IncognitoProfiles.isIncognitoName("vidorax-incogm1x2abc9"))
    assertFalse("a browser profile, not incognito", IncognitoProfiles.isIncognitoName("vidorax-abc123"))
    assertFalse(IncognitoProfiles.isIncognitoName("Default"))
    assertFalse(IncognitoProfiles.isIncognitoName("vidorax-incog"))
    assertFalse(IncognitoProfiles.isIncognitoName("vidorax-incogABC"))
    assertFalse("over B20's 32 characters", IncognitoProfiles.isIncognitoName("vidorax-incog" + "a".repeat(28)))
    assertFalse(IncognitoProfiles.isIncognitoName(null))
  }

  @Test
  fun noIncognitoWithoutWebViewProfiles() {
    assertFalse(IncognitoProfiles.start("vidorax-incoga1", acceptCookies = true, supported = { false }, jarOf = { jar }))
    assertNull(IncognitoProfiles.liveName)
    assertFalse(IncognitoProfiles.start("vidorax-abc", acceptCookies = true, supported = { true }, jarOf = { jar }))
  }

  @Test
  fun onlyTheLiveSessionIsAppliedAndEachSessionHasItsOwnName() {
    val app = RuntimeEnvironment.getApplication()
    val first = WebView(app)
    assertTrue(IncognitoProfiles.start("vidorax-incoga1", acceptCookies = true, supported = { true }, jarOf = { jar }))
    assertTrue(IncognitoProfiles.apply(first, "vidorax-incoga1", join))
    assertEquals("vidorax-incoga1", IncognitoProfiles.nameOf(first))
    assertSame(jar, IncognitoProfiles.liveCookies("vidorax-incoga1"))

    // Another name (an old session, a typo) is never joined: the WebView stays where it was and JS finds out.
    val stray = WebView(app)
    assertFalse(IncognitoProfiles.apply(stray, "vidorax-incogold", join))
    assertNull(IncognitoProfiles.nameOf(stray))

    // The session ends: no jar for it any more, and a new session has a new name.
    IncognitoProfiles.end("vidorax-incoga1")
    assertNull(IncognitoProfiles.liveCookies("vidorax-incoga1"))
    assertTrue(IncognitoProfiles.start("vidorax-incogb2", acceptCookies = false, supported = { true }, jarOf = { jar }))
    assertFalse(IncognitoProfiles.apply(WebView(app), "vidorax-incoga1", join))
    assertEquals(listOf("vidorax-incoga1"), joined.map { it.second })
  }

  @Test
  fun theCreateViewInstancePropReachesTheHook() {
    // What the patched RNCWebViewManager does around createViewInstance, then RNCWebViewManagerImpl's
    // beforeWebViewSetup call; RNCWebView needs a live React instance, so the test instance skips its constructor.
    val received = mutableListOf<String>()
    val listener = object : RNCWebViewHooks.Listener {
      override fun beforeWebViewSetup(webView: RNCWebView) {
        received += "normal"
      }
      override fun beforeWebViewSetupInProfile(webView: RNCWebView, webProfile: String) {
        received += webProfile
      }
      override fun onWebViewCreated(webView: RNCWebView) {}
      override fun observeRequest(view: WebView?, request: android.webkit.WebResourceRequest) {}
      override fun onDownloadStart(
        webView: RNCWebView,
        url: String,
        userAgent: String?,
        contentDisposition: String?,
        mimeType: String?,
        contentLength: Long,
      ) = false
    }
    val view = bareWebView()
    RNCWebViewHooks.setListener(listener)
    try {
      val incognitoProps = ReactStylesDiffMap(JavaOnlyMap.of("webProfile", "vidorax-incoga1", "javaScriptEnabled", true))
      RNCWebViewHooks.setPendingWebProfile(RNCWebViewHooks.webProfileProp(incognitoProps))
      RNCWebViewHooks.beforeWebViewSetup(view)
      RNCWebViewHooks.setPendingWebProfile(null)
      // A normal tab passes no prop: the plain hook, as before B11.
      RNCWebViewHooks.setPendingWebProfile(RNCWebViewHooks.webProfileProp(ReactStylesDiffMap(JavaOnlyMap.of("javaScriptEnabled", true))))
      RNCWebViewHooks.beforeWebViewSetup(view)
      // The slot is used once: a WebView created right after (no manager call) is normal.
      RNCWebViewHooks.setPendingWebProfile("vidorax-incoga1")
      RNCWebViewHooks.beforeWebViewSetup(view)
      RNCWebViewHooks.beforeWebViewSetup(view)
    } finally {
      RNCWebViewHooks.setPendingWebProfile(null)
      RNCWebViewHooks.removeListener(listener)
    }
    assertEquals(listOf("vidorax-incoga1", "normal", "vidorax-incoga1", "normal"), received)
    assertNull(RNCWebViewHooks.webProfileProp(null))
    assertNull(RNCWebViewHooks.webProfileProp(ReactStylesDiffMap(JavaOnlyMap.of("webProfile", ""))))
    assertNull(RNCWebViewHooks.webProfileProp(ReactStylesDiffMap(JavaOnlyMap.of("webProfile", null))))
    assertNull(RNCWebViewHooks.webProfileProp(ReactStylesDiffMap(JavaOnlyMap.of("webProfile", 3.0))))
  }

  private fun bareWebView(): RNCWebView {
    val field = Class.forName("sun.misc.Unsafe").getDeclaredField("theUnsafe")
    field.isAccessible = true
    val unsafe = field.get(null)
    val allocate = unsafe.javaClass.getMethod("allocateInstance", Class::class.java)
    return allocate.invoke(unsafe, RNCWebView::class.java) as RNCWebView
  }
}
