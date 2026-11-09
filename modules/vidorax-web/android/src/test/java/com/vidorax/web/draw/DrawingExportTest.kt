package com.vidorax.web.draw

import android.graphics.Bitmap
import android.graphics.Canvas
import android.graphics.Color
import android.graphics.Paint
import android.graphics.Path
import android.graphics.RectF
import org.junit.Assert.assertEquals
import org.junit.Assert.assertNotNull
import org.junit.Assert.assertNull
import org.junit.Assert.assertNotSame
import org.junit.Test
import org.junit.runner.RunWith
import org.robolectric.RobolectricTestRunner
import org.robolectric.RuntimeEnvironment
import org.robolectric.annotation.GraphicsMode
import java.io.File

@RunWith(RobolectricTestRunner::class)
@GraphicsMode(GraphicsMode.Mode.NATIVE)
class DrawingExportTest {
  @Test
  fun parsesStrokesAndSkipsInvalidOnes() {
    val strokes = DrawingExport.parseStrokes(
      """[{"color":"#FF0000","width":8,"points":[1,2,3,4,5]},{"color":"red","width":3,"points":[1,1]},
         {"color":"#00ff00","width":999,"points":[7,7]},{"color":"#0000FF","points":[]},"junk"]""",
    )
    assertEquals(2, strokes.size)
    assertEquals(Color.RED, strokes[0].color)
    assertEquals(4, strokes[0].points.size) // the odd trailing value is dropped
    assertEquals(200f, strokes[1].width) // clamped
    assertEquals(0, DrawingExport.parseStrokes("not json").size)
  }

  /** Robolectric (here on Windows) doesn't rasterize Canvas calls, so the calls are recorded; pixels: device list. */
  private class RecordingCanvas(bitmap: Bitmap) : Canvas(bitmap) {
    val calls = mutableListOf<String>()
    override fun drawPath(path: Path, paint: Paint) {
      val bounds = RectF().also { path.computeBounds(it, true) }
      calls += "path ${Integer.toHexString(paint.color)} ${paint.strokeWidth} ${paint.style} ${paint.strokeCap} " +
        "${bounds.left},${bounds.top}-${bounds.right},${bounds.bottom}"
    }
    override fun drawCircle(cx: Float, cy: Float, radius: Float, paint: Paint) {
      calls += "dot ${Integer.toHexString(paint.color)} $cx,$cy r$radius ${paint.style}"
    }
  }

  @Test
  fun drawsEachStrokeWithItsColourAndWidthOnACopy() {
    val base = Bitmap.createBitmap(40, 40, Bitmap.Config.ARGB_8888)
    var canvas: RecordingCanvas? = null
    val out = DrawingExport.render(
      base,
      listOf(
        DrawingExport.Stroke(Color.BLUE, 6f, floatArrayOf(2f, 20f, 38f, 20f, 38f, 30f)),
        DrawingExport.Stroke(Color.RED, 10f, floatArrayOf(5f, 5f)),
      ),
    ) { RecordingCanvas(it).also { c -> canvas = c } }
    assertEquals(
      listOf("path ff0000ff 6.0 STROKE ROUND 2.0,20.0-38.0,30.0", "dot ffff0000 5.0,5.0 r5.0 FILL"),
      canvas!!.calls,
    )
    assertNotSame(base, out)
    assertEquals(40 to 40, out.width to out.height)
  }

  @Test
  fun readsPicturesOnlyFromItsOwnCacheFolder() {
    val context = RuntimeEnvironment.getApplication()
    val dir = File(context.cacheDir, DrawingExport.DIR).apply { mkdirs() }
    val inside = File(dir, "page.jpg").apply { writeText("x") }
    val outside = File(context.cacheDir, "other.jpg").apply { writeText("x") }
    assertNotNull(DrawingExport.sourceFile(context, "file://${inside.path}"))
    assertNull(DrawingExport.sourceFile(context, "file://${outside.path}"))
    assertNull(DrawingExport.sourceFile(context, "file://${dir.path}/../other.jpg"))
  }
}
