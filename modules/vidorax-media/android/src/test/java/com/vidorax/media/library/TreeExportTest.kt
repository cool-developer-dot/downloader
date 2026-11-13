package com.vidorax.media.library

import org.junit.Assert.assertEquals
import org.junit.Assert.assertFalse
import org.junit.Test

class TreeExportTest {
  @Test
  fun `folder names keep letters of every script`() {
    assertEquals("میری ویڈیوز", TreeExport.safeFolderName("میری ویڈیوز"))
    assertEquals("Instagram", TreeExport.safeFolderName("Instagram"))
    assertEquals("example.com", TreeExport.safeFolderName("example.com"))
  }

  @Test
  fun `folder names can never climb out of the picked folder or hide`() {
    for (name in listOf("..", ".", "../..", "a/../b", ".hidden")) {
      val safe = TreeExport.safeFolderName(name)
      assertFalse(safe, safe.contains('/'))
      assertFalse(safe, safe.startsWith("."))
      assertFalse(safe, safe.isEmpty())
    }
  }
}
