package com.vidorax.web.widget

import android.appwidget.AppWidgetManager
import android.appwidget.AppWidgetProvider
import android.content.Context

/** B24 #65 — draws the search widget when Android asks (placed, resized, after a reboot or an update). */
class SearchWidgetProvider : AppWidgetProvider() {
  override fun onUpdate(context: Context, appWidgetManager: AppWidgetManager, appWidgetIds: IntArray) {
    SearchWidget.renderAll(context.applicationContext, appWidgetIds)
  }
}
