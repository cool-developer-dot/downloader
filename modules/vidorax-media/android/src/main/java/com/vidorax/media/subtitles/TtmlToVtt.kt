package com.vidorax.media.subtitles

import android.util.Xml
import java.io.StringReader
import org.xmlpull.v1.XmlPullParser

/**
 * H19: TTML (DASH `application/ttml+xml` sidecars) as WebVTT — only the common subset that converts without guessing:
 * `<p>` cues timed with `begin` and `end` (or `dur`), clock times (`hh:mm:ss.fff`, `hh:mm:ss:ff` with
 * `ttp:frameRate`) or offsets (`12.3s`, `500ms`, `2m`, `1h`, `30f`, `900t` with `ttp:tickRate`), `<br/>` as a line
 * break, `<span>` text kept and styling dropped.
 *
 * Anything else — timing on `body`/`div`/`span`, a `p` without timing, images — returns null: the subtitle is reported
 * as not converted rather than written with wrong times.
 */
internal object TtmlToVtt {
  private const val TTP = "http://www.w3.org/ns/ttml#parameter"
  private val CLOCK = Regex("""^(\d+):(\d{2}):(\d{2})(?:\.(\d+))?$""")
  private val CLOCK_FRAMES = Regex("""^(\d+):(\d{2}):(\d{2}):(\d+)(?:\.(\d+))?$""")
  private val OFFSET = Regex("""^(\d+(?:\.\d+)?)(h|m|s|ms|f|t)$""")
  private val TIMING = setOf("begin", "end", "dur")

  fun convert(ttml: String): String? = runCatching { convertOrNull(ttml) }.getOrNull()

  /** Milliseconds of a TTML time expression, or null when it is not one this converter supports. */
  fun parseTime(value: String, frameRate: Double, tickRate: Double): Long? {
    val text = value.trim()
    CLOCK.matchEntire(text)?.let { m ->
      val fraction = m.groupValues[4].takeIf { it.isNotEmpty() }?.let { "0.$it".toDouble() } ?: 0.0
      val seconds = m.groupValues[1].toLong() * 3600 + m.groupValues[2].toLong() * 60 + m.groupValues[3].toLong() + fraction
      return Math.round(seconds * 1000)
    }
    CLOCK_FRAMES.matchEntire(text)?.let { m ->
      val frames = m.groupValues[4].toDouble() + (m.groupValues[5].takeIf { it.isNotEmpty() }?.let { "0.$it".toDouble() } ?: 0.0)
      val seconds = m.groupValues[1].toLong() * 3600 + m.groupValues[2].toLong() * 60 + m.groupValues[3].toLong() + frames / frameRate
      return Math.round(seconds * 1000)
    }
    OFFSET.matchEntire(text)?.let { m ->
      val amount = m.groupValues[1].toDouble()
      val seconds = when (m.groupValues[2]) {
        "h" -> amount * 3600
        "m" -> amount * 60
        "s" -> amount
        "ms" -> amount / 1000
        "f" -> amount / frameRate
        else -> amount / tickRate
      }
      return Math.round(seconds * 1000)
    }
    return null
  }

  private fun convertOrNull(ttml: String): String? {
    val parser = Xml.newPullParser()
    parser.setFeature(XmlPullParser.FEATURE_PROCESS_NAMESPACES, true)
    parser.setInput(StringReader(ttml))
    var frameRate = 30.0
    var tickRate = 1.0
    val cues = ArrayList<WebVtt.Cue>()
    var inP = false
    var start = 0L
    var end = 0L
    val text = StringBuilder()
    var event = parser.eventType
    while (event != XmlPullParser.END_DOCUMENT) {
      when (event) {
        XmlPullParser.START_TAG -> {
          val name = parser.name
          if (name == "tt") {
            parser.getAttributeValue(TTP, "frameRate")?.toDoubleOrNull()?.takeIf { it > 0 }?.let { frameRate = it }
            parser.getAttributeValue(TTP, "tickRate")?.toDoubleOrNull()?.takeIf { it > 0 }?.let { tickRate = it }
          }
          if (name == "image" || (0 until parser.attributeCount).any { parser.getAttributeName(it) == "backgroundImage" }) return null
          val timed = (0 until parser.attributeCount).any { parser.getAttributeName(it) in TIMING }
          when (name) {
            "body", "div", "span" -> if (timed) return null
            "p" -> {
              if (inP) return null
              val begin = parser.getAttributeValue(null, "begin")?.let { parseTime(it, frameRate, tickRate) } ?: return null
              val stop = parser.getAttributeValue(null, "end")?.let { parseTime(it, frameRate, tickRate) }
                ?: parser.getAttributeValue(null, "dur")?.let { parseTime(it, frameRate, tickRate) }?.let { begin + it }
                ?: return null
              if (stop < begin) return null
              inP = true
              start = begin
              end = stop
              text.setLength(0)
            }
            "br" -> if (inP) text.append('\n')
          }
        }
        XmlPullParser.TEXT -> if (inP) text.append(parser.text.replace(Regex("\\s+"), " "))
        XmlPullParser.END_TAG -> if (parser.name == "p" && inP) {
          inP = false
          val lines = text.toString().split('\n').map { it.trim() }.filter { it.isNotEmpty() }.map(::escape)
          if (lines.isNotEmpty()) cues += WebVtt.Cue(start, end, "", lines)
        }
      }
      event = parser.next()
    }
    if (cues.isEmpty()) return null
    return WebVtt.write(cues.sortedBy { it.startMs })
  }

  /** WebVTT cue text: `&`, `<` and `>` must be escaped. */
  private fun escape(line: String): String = line.replace("&", "&amp;").replace("<", "&lt;").replace(">", "&gt;")
}
