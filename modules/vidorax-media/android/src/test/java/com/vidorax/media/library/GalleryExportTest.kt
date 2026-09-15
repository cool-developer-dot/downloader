package com.vidorax.media.library

import com.vidorax.media.model.SiteId
import org.junit.Assert.assertEquals
import org.junit.Test

class GalleryExportTest {
  @Test
  fun folderDependsOnSiteAndMediaKind() {
    assertEquals("Movies/VidoraX/Instagram", galleryFolder(audioOnly = false, site = SiteId.INSTAGRAM))
    assertEquals("Music/VidoraX/X", galleryFolder(audioOnly = true, site = SiteId.TWITTER))
  }

  @Test
  fun fileNameIsTheSafeTitleWithNumberedCopies() {
    assertEquals("Sunset timelapse.mp4", galleryFileName("Sunset: timelapse", "mp4"))
    assertEquals("Sunset timelapse (2).mp4", galleryFileName("Sunset: timelapse", "mp4", copy = 2))
  }
}
