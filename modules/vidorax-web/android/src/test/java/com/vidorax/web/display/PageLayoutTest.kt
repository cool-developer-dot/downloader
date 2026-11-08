package com.vidorax.web.display

import android.webkit.WebSettings
import android.webkit.WebView
import org.junit.Assert.assertEquals
import org.junit.Test
import org.junit.runner.RunWith
import org.robolectric.RobolectricTestRunner
import org.robolectric.RuntimeEnvironment

@RunWith(RobolectricTestRunner::class)
class PageLayoutTest {
  @Test
  fun textReflowIsTextAutosizingAndOffIsWebViewsDefault() {
    assertEquals(WebSettings.LayoutAlgorithm.TEXT_AUTOSIZING, PageLayout.layoutAlgorithm(true))
    assertEquals(WebSettings.LayoutAlgorithm.NORMAL, PageLayout.layoutAlgorithm(false))
  }

  @Test
  fun initialScaleOutsideTheRangeMeansDefault() {
    assertEquals(0, PageLayout.normalizeScale(0))
    assertEquals(0, PageLayout.normalizeScale(-50))
    assertEquals(0, PageLayout.normalizeScale(24))
    assertEquals(25, PageLayout.normalizeScale(25))
    assertEquals(150, PageLayout.normalizeScale(150))
    assertEquals(500, PageLayout.normalizeScale(500))
    assertEquals(0, PageLayout.normalizeScale(501))
  }

  @Test
  fun applySetsTheLayoutAlgorithmBothWays() {
    val webView = WebView(RuntimeEnvironment.getApplication())
    PageLayout.apply(webView, textAutosizing = true, initialScale = 120, algorithmicDarkening = false)
    assertEquals(WebSettings.LayoutAlgorithm.TEXT_AUTOSIZING, webView.settings.layoutAlgorithm)
    PageLayout.apply(webView, textAutosizing = false, initialScale = 0, algorithmicDarkening = false)
    assertEquals(WebSettings.LayoutAlgorithm.NORMAL, webView.settings.layoutAlgorithm)
  }

  @Test
  fun darkeningNeverThrowsWhereTheWebViewCannotDoIt() {
    // Robolectric's WebView has no provider features: the call reports false instead of failing.
    val webView = WebView(RuntimeEnvironment.getApplication())
    assertEquals(PageLayout.canDarkenAlgorithmically(), PageLayout.apply(webView, false, 0, true))
  }
}
