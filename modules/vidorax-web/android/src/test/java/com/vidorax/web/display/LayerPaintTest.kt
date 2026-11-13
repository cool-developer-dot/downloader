package com.vidorax.web.display

import android.graphics.ColorMatrixColorFilter
import android.view.View
import org.junit.Assert.assertEquals
import org.junit.Assert.assertNotNull
import org.junit.Assert.assertNull
import org.junit.Assert.assertTrue
import org.junit.Test
import org.junit.runner.RunWith
import org.robolectric.RobolectricTestRunner
import org.robolectric.RuntimeEnvironment

@RunWith(RobolectricTestRunner::class)
class LayerPaintTest {
  private val identity = listOf(
    1.0, 0.0, 0.0, 0.0, 0.0,
    0.0, 1.0, 0.0, 0.0, 0.0,
    0.0, 0.0, 1.0, 0.0, 0.0,
    0.0, 0.0, 0.0, 1.0, 0.0,
  )
  private val grayscale = listOf(
    0.2126, 0.7152, 0.0722, 0.0, 0.0,
    0.2126, 0.7152, 0.0722, 0.0, 0.0,
    0.2126, 0.7152, 0.0722, 0.0, 0.0,
    0.0, 0.0, 0.0, 1.0, 0.0,
  )

  @Test
  fun onlyTwentyFiniteBoundedNumbersAreAMatrix() {
    assertNotNull(LayerPaint.validMatrix(grayscale))
    assertNull(LayerPaint.validMatrix(null))
    assertNull(LayerPaint.validMatrix(grayscale.dropLast(1)))
    assertNull(LayerPaint.validMatrix(grayscale + 0.0))
    assertNull(LayerPaint.validMatrix(grayscale.toMutableList().also { it[3] = Double.NaN }))
    assertNull(LayerPaint.validMatrix(grayscale.toMutableList().also { it[3] = Double.POSITIVE_INFINITY }))
    assertNull(LayerPaint.validMatrix(grayscale.toMutableList().also { it[3] = 1000.0 }))
    assertNull("identity is no filter", LayerPaint.validMatrix(identity))
  }

  @Test
  fun layerTypeFollowsFilterAndSoftware() {
    val m = LayerPaint.validMatrix(grayscale)
    assertEquals(View.LAYER_TYPE_NONE, LayerPaint.layerTypeFor(LayerPaint.State(null, false)))
    assertEquals(View.LAYER_TYPE_HARDWARE, LayerPaint.layerTypeFor(LayerPaint.State(m, false)))
    assertEquals(View.LAYER_TYPE_SOFTWARE, LayerPaint.layerTypeFor(LayerPaint.State(null, true)))
    assertEquals(View.LAYER_TYPE_SOFTWARE, LayerPaint.layerTypeFor(LayerPaint.State(m, true)))
    assertNull(LayerPaint.paintFor(LayerPaint.State(null, true)))
    assertTrue(LayerPaint.paintFor(LayerPaint.State(m, false))!!.colorFilter is ColorMatrixColorFilter)
  }

  @Test
  fun filterAndSoftwareLayerNeverWipeEachOther() {
    val view = View(RuntimeEnvironment.getApplication())
    val m = LayerPaint.validMatrix(grayscale)
    LayerPaint.setColorMatrix(view, m)
    assertEquals(View.LAYER_TYPE_HARDWARE, view.layerType)
    LayerPaint.setSoftware(view, true)
    assertEquals(View.LAYER_TYPE_SOFTWARE, view.layerType)
    assertNotNull("the filter stays with a software layer", LayerPaint.stateOf(view).matrix)
    LayerPaint.setColorMatrix(view, null)
    assertEquals(View.LAYER_TYPE_SOFTWARE, view.layerType)
    LayerPaint.setSoftware(view, false)
    assertEquals(View.LAYER_TYPE_NONE, view.layerType)
    assertEquals(LayerPaint.State(null, false), LayerPaint.stateOf(view))
  }

  @Test
  fun aViewWithoutFilterIsLeftAtTheDefault() {
    val view = View(RuntimeEnvironment.getApplication())
    LayerPaint.setColorMatrix(view, null)
    assertEquals(View.LAYER_TYPE_NONE, view.layerType)
  }
}
