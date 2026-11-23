package com.vidorax.media.player

import org.junit.Assert.assertEquals
import org.junit.Test

class FadeCurveTest {
  @Test
  fun fadesLinearlyIn100MsSteps() {
    assertEquals(100, FadeCurve.steps(10_000))
    assertEquals(0, FadeCurve.steps(0))
    assertEquals(0, FadeCurve.steps(-5))
    assertEquals(1f, FadeCurve.volumeAt(1f, 0, 100), 1e-6f)
    assertEquals(0.5f, FadeCurve.volumeAt(1f, 50, 100), 1e-6f)
    assertEquals(0.4f, FadeCurve.volumeAt(0.8f, 50, 100), 1e-6f)
    assertEquals(0f, FadeCurve.volumeAt(1f, 100, 100), 1e-6f)
    assertEquals(0f, FadeCurve.volumeAt(1f, 3, 0), 1e-6f)
  }
}
