package com.vidorax.media.subtitles

import org.junit.Assert.assertEquals
import org.junit.Assert.assertNull
import org.junit.Test
import org.junit.runner.RunWith
import org.robolectric.RobolectricTestRunner

/** H19: TTML sidecars as WebVTT — the common subset only; anything else is reported, never guessed. */
@RunWith(RobolectricTestRunner::class)
class TtmlToVttTest {
  private fun tt(body: String, params: String = "") = """
    <?xml version="1.0" encoding="UTF-8"?>
    <tt xmlns="http://www.w3.org/ns/ttml" xmlns:ttp="http://www.w3.org/ns/ttml#parameter"
        xmlns:tts="http://www.w3.org/ns/ttml#styling" xml:lang="en" $params>
      <head><styling><style xml:id="s1" tts:color="white"/></styling></head>
      <body><div>$body</div></body>
    </tt>
  """.trimIndent()

  @Test fun clockTimesSpansAndLineBreaks() {
    val vtt = TtmlToVtt.convert(
      tt(
        """
        <p begin="00:00:01.000" end="00:00:02.500">Hello <span tts:fontStyle="italic">world</span><br/>second line</p>
        <p begin="00:01:00.25" dur="00:00:01.5">Fish &amp; chips &lt;3</p>
        """,
      ),
    )
    assertEquals(
      "WEBVTT\n\n00:00:01.000 --> 00:00:02.500\nHello world\nsecond line\n\n00:01:00.250 --> 00:01:01.750\nFish &amp; chips &lt;3\n",
      vtt,
    )
  }

  @Test fun framesTicksAndOffsets() {
    assertEquals(1_500L, TtmlToVtt.parseTime("00:00:01:12", frameRate = 24.0, tickRate = 1.0))
    assertEquals(2_000L, TtmlToVtt.parseTime("20000000t", frameRate = 30.0, tickRate = 10_000_000.0))
    assertEquals(12_300L, TtmlToVtt.parseTime("12.3s", 30.0, 1.0))
    assertEquals(500L, TtmlToVtt.parseTime("500ms", 30.0, 1.0))
    assertEquals(120_000L, TtmlToVtt.parseTime("2m", 30.0, 1.0))
    assertEquals(1_000L, TtmlToVtt.parseTime("25f", 25.0, 1.0))
    assertNull(TtmlToVtt.parseTime("wallclock(2024-01-01)", 30.0, 1.0))

    val vtt = TtmlToVtt.convert(tt("""<p begin="0t" end="10000000t">Tick</p>""", params = """ttp:tickRate="10000000""""))
    assertEquals("WEBVTT\n\n00:00:00.000 --> 00:00:01.000\nTick\n", vtt)
  }

  @Test fun anythingOutsideTheSubsetIsNotConverted() {
    assertNull("a timed div", TtmlToVtt.convert(tt("").replace("<div>", """<div begin="00:00:05.000">""").replace("</div>", """<p begin="1s" end="2s">x</p></div>""")))
    assertNull("a timed span", TtmlToVtt.convert(tt("""<p begin="1s" end="3s"><span begin="2s">late</span></p>""")))
    assertNull("a p without timing", TtmlToVtt.convert(tt("""<p>untimed</p>""")))
    assertNull("an image subtitle", TtmlToVtt.convert(tt("""<p begin="1s" end="2s"><image src="a.png"/></p>""")))
    assertNull("no cues", TtmlToVtt.convert(tt("")))
    assertNull("not XML", TtmlToVtt.convert("WEBVTT"))
  }
}
