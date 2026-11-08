package com.vidorax.web.display

import android.graphics.ColorMatrixColorFilter
import android.graphics.Paint
import android.view.View
import java.util.WeakHashMap

/**
 * B16 #179 / #180 (and B18 #189) — the one place that sets a tab WebView's layer: its type and its paint together, so
 * one feature never wipes another's.
 *
 * - **Colour filter / night light**: a 4×5 colour matrix (the app computes it, `page-display-filters.ts`) drawn as the
 *   layer paint's `ColorMatrixColorFilter` on a hardware layer — the whole page's pixels, never a CSS filter in the
 *   page. Only views that need it get a layer; without one the view is back to `LAYER_TYPE_NONE` (WebView's default).
 * - **Software layer** (B18 #189, hardware acceleration off for a tab): `LAYER_TYPE_SOFTWARE`, keeping the filter.
 */
object LayerPaint {
  data class State(val matrix: FloatArray?, val software: Boolean) {
    override fun equals(other: Any?): Boolean =
      other is State && software == other.software && (matrix?.contentEquals(other.matrix) ?: (other.matrix == null))

    override fun hashCode(): Int = 31 * (matrix?.contentHashCode() ?: 0) + software.hashCode()
  }

  private val NONE = State(null, false)
  private val states = WeakHashMap<View, State>()

  /** 20 finite numbers, else null (no filter); the identity matrix is no filter too. */
  fun validMatrix(values: List<Double>?): FloatArray? {
    if (values == null || values.size != 20 || values.any { !it.isFinite() || it < -10.0 || it > 10.0 }) return null
    val matrix = FloatArray(20) { values[it].toFloat() }
    return if (isIdentity(matrix)) null else matrix
  }

  fun isIdentity(matrix: FloatArray): Boolean =
    matrix.indices.all { i -> matrix[i] == (if (i == 0 || i == 6 || i == 12 || i == 18) 1f else 0f) }

  fun layerTypeFor(state: State): Int = when {
    state.software -> View.LAYER_TYPE_SOFTWARE
    state.matrix != null -> View.LAYER_TYPE_HARDWARE
    else -> View.LAYER_TYPE_NONE
  }

  fun paintFor(state: State): Paint? = state.matrix?.let { m -> Paint().apply { colorFilter = ColorMatrixColorFilter(m) } }

  fun stateOf(view: View): State = synchronized(states) { states[view] } ?: NONE

  /** Sets the colour matrix (null = none) of [view]'s layer. Main thread. */
  fun setColorMatrix(view: View, matrix: FloatArray?) = update(view) { it.copy(matrix = matrix) }

  /** B18 #189: a software layer for [view] (hardware acceleration off), or back to the default. Main thread. */
  fun setSoftware(view: View, software: Boolean) = update(view) { it.copy(software = software) }

  private fun update(view: View, change: (State) -> State): State {
    val before = stateOf(view)
    val after = change(before)
    synchronized(states) {
      if (after == NONE) states.remove(view) else states[view] = after
    }
    if (after != before || view.layerType != layerTypeFor(after)) view.setLayerType(layerTypeFor(after), paintFor(after))
    return after
  }
}
