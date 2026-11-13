package com.vidorax.web.performance

import android.view.View
import android.webkit.WebView
import com.vidorax.web.display.LayerPaint
import org.junit.Assert.assertEquals
import org.junit.Assert.assertFalse
import org.junit.Assert.assertNotNull
import org.junit.Assert.assertTrue
import org.junit.Test
import org.junit.runner.RunWith
import org.robolectric.RobolectricTestRunner
import org.robolectric.RuntimeEnvironment

@RunWith(RobolectricTestRunner::class)
class ImageBlockingTest {
  @Test
  fun blocksAndUnblocksNetworkPictures() {
    val webView = WebView(RuntimeEnvironment.getApplication())
    assertFalse("WebView's default: pictures load", webView.settings.blockNetworkImage)
    assertTrue(ImageBlocking.apply(webView, true))
    assertTrue(webView.settings.blockNetworkImage)
    assertFalse("no change, no call", ImageBlocking.apply(webView, true))
    assertTrue(ImageBlocking.apply(webView, false))
    assertFalse(webView.settings.blockNetworkImage)
  }

  @Test
  fun softwareLayerKeepsAColourFilterAndGoesBackToTheDefault() {
    // #189 goes through LayerPaint, the same owner as B16's colour filter.
    val webView = WebView(RuntimeEnvironment.getApplication())
    LayerPaint.setSoftware(webView, true)
    assertEquals(View.LAYER_TYPE_SOFTWARE, webView.layerType)
    LayerPaint.setColorMatrix(webView, FloatArray(20) { if (it % 6 == 0) 0.5f else 0f })
    assertEquals(View.LAYER_TYPE_SOFTWARE, webView.layerType)
    assertNotNull(LayerPaint.stateOf(webView).matrix)
    LayerPaint.setColorMatrix(webView, null)
    LayerPaint.setSoftware(webView, false)
    assertEquals("never forced to hardware", View.LAYER_TYPE_NONE, webView.layerType)
  }
}
