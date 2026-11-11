package com.vidorax.media.widget

import android.appwidget.AppWidgetManager
import android.appwidget.AppWidgetProvider
import android.content.Context
import com.vidorax.media.MediaServices
import kotlinx.coroutines.launch

/**
 * H22 Home Widget (#456): up to three active downloads (title, percentage, status) and a "Paste link" button
 * (`vidorax://paste-link`, H7's route); tapping a download opens Downloads. Android asks for a first drawing when the
 * widget is placed (and after a reboot or an update); after that the engine's state changes redraw it
 * ([DownloadsWidget.install], at most every 2 s). It reads the engine's own records and never starts the engine or a
 * download, so placing a widget changes nothing about the downloads themselves.
 */
class DownloadsWidgetProvider : AppWidgetProvider() {
  override fun onUpdate(context: Context, appWidgetManager: AppWidgetManager, appWidgetIds: IntArray) {
    val app = context.applicationContext
    val pending = goAsync()
    MediaServices.get(app).scope.launch {
      try {
        DownloadsWidget.renderAll(app, appWidgetIds)
      } catch (e: Exception) {
        // Drawn again at the next state change.
      } finally {
        pending.finish()
      }
    }
  }
}
