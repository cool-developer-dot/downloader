package com.vidorax.web.draw

import android.content.Context
import android.graphics.Bitmap
import android.graphics.BitmapFactory
import android.graphics.Canvas
import android.graphics.Paint
import android.graphics.Path
import org.json.JSONArray
import java.io.File

/**
 * B23 #279 — Draw on page: the page picture (B1's snapshot, copied by JS into `<cache>/drawings/`) with the user's pen
 * strokes drawn on it, as a PNG saved to Pictures/VidoraX (MediaStore, Android 10+, via QrImage.saveToGallery) or
 * written to `<cache>/drawings/` for the share sheet (FileProvider path `drawings/`). The eraser removes whole strokes
 * in JS, so only the strokes left are drawn here. Reads only a picture inside the app's own cache folder.
 */
internal object DrawingExport {
  const val DIR = "drawings"
  const val MAX_STROKES = 2000
  const val MAX_POINTS = 20_000

  /** One pen stroke in picture pixels: colour as ARGB, width in pixels, points x0, y0, x1, y1… */
  class Stroke(val color: Int, val width: Float, val points: FloatArray)

  /** `[{ "color": "#RRGGBB", "width": 6, "points": [x, y, …] }, …]` — invalid parts are skipped; bounded. */
  fun parseStrokes(json: String): List<Stroke> {
    val list = try {
      JSONArray(json)
    } catch (_: Exception) {
      return emptyList()
    }
    val out = mutableListOf<Stroke>()
    var total = 0
    for (i in 0 until minOf(list.length(), MAX_STROKES)) {
      val o = list.optJSONObject(i) ?: continue
      val color = parseColor(o.optString("color")) ?: continue
      val width = o.optDouble("width", 4.0).toFloat().coerceIn(1f, 200f)
      val pts = o.optJSONArray("points") ?: continue
      val n = (pts.length() / 2) * 2
      if (n < 2 || total + n > MAX_POINTS * 2) continue
      val points = FloatArray(n) { pts.optDouble(it, Double.NaN).toFloat() }
      if (points.any { it.isNaN() || it.isInfinite() }) continue
      total += n
      out += Stroke(color, width, points)
    }
    return out
  }

  /** "#RRGGBB" → opaque ARGB, or null. */
  fun parseColor(value: String): Int? {
    if (!Regex("^#[0-9A-Fa-f]{6}$").matches(value)) return null
    return (0xFF shl 24) or value.substring(1).toInt(16)
  }

  /** The picture to draw on, only from the app's own `<cache>/drawings/` folder. */
  fun sourceFile(context: Context, uri: String): File? {
    val file = File(uri.removePrefix("file://")).canonicalFile
    val dir = File(context.cacheDir, DIR).canonicalFile
    return if (file.parentFile == dir && file.isFile) file else null
  }

  /** A copy of [base] with [strokes] drawn on it (round pen). [canvasOf]: tests record the calls. */
  fun render(base: Bitmap, strokes: List<Stroke>, canvasOf: (Bitmap) -> Canvas = ::Canvas): Bitmap {
    val out = base.copy(Bitmap.Config.ARGB_8888, true)
    val canvas = canvasOf(out)
    val paint = Paint(Paint.ANTI_ALIAS_FLAG).apply {
      strokeCap = Paint.Cap.ROUND
      strokeJoin = Paint.Join.ROUND
    }
    for (stroke in strokes) {
      paint.color = stroke.color
      paint.strokeWidth = stroke.width
      val p = stroke.points
      if (p.size == 2) {
        paint.style = Paint.Style.FILL
        canvas.drawCircle(p[0], p[1], stroke.width / 2f, paint)
        continue
      }
      paint.style = Paint.Style.STROKE
      val path = Path().apply {
        moveTo(p[0], p[1])
        var i = 2
        while (i + 1 < p.size) {
          lineTo(p[i], p[i + 1])
          i += 2
        }
      }
      canvas.drawPath(path, paint)
    }
    return out
  }

  fun load(file: File): Bitmap? = BitmapFactory.decodeFile(file.path)

  /** For the share sheet: replaces any earlier export (the picture source stays). */
  fun writeShareFile(context: Context, bitmap: Bitmap): File {
    val dir = File(context.cacheDir, DIR).apply { mkdirs() }
    dir.listFiles()?.filter { it.name.startsWith("vidorax-drawing-") }?.forEach { it.delete() }
    val file = File(dir, "vidorax-drawing-${System.currentTimeMillis()}.png")
    file.outputStream().use { bitmap.compress(Bitmap.CompressFormat.PNG, 100, it) }
    return file
  }
}
