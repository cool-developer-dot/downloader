package com.vidorax.media.files

import org.junit.Assert.assertEquals
import org.junit.Test

class SystemDownloadsTest {
  @Test
  fun `the title DownloadManager kept is the file name`() {
    assertEquals("beach.jpg", SystemDownloads.displayName(" beach.jpg ", "file:///storage/emulated/0/Download/other.jpg"))
  }

  @Test
  fun `without a title the local file's name, else Download`() {
    assertEquals("report.pdf", SystemDownloads.displayName(null, "file:///storage/emulated/0/Download/report.pdf"))
    assertEquals("Download", SystemDownloads.displayName("  ", null))
  }
}
