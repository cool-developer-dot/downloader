package com.vidorax.web.widget

import android.app.PendingIntent
import android.appwidget.AppWidgetManager
import android.content.ComponentName
import android.content.Context
import android.content.Intent
import android.widget.RemoteViews
import com.vidorax.web.R

/**
 * B24 #65 — the home-screen search widget (4×1, resizable): one bar, "Search or type a web address", light / dark
 * (values-night) and Urdu (values-ur). A tap starts the app's launcher activity with a private action, handed to JS
 * once ([takeSearchTap]); JS opens a new tab with the address bar focused after App Lock (as B9's bookmark shortcuts).
 * No periodic updates; nothing is read or shown but the label.
 */
internal object SearchWidget {
  const val ACTION_SEARCH = "com.vidorax.web.action.SEARCH_WIDGET"
  private const val EXTRA_CONSUMED = "com.vidorax.web.extra.SEARCH_WIDGET_CONSUMED"
  private const val REQUEST_CODE = 6501

  /** The app's launcher activity with the private action (explicit component: no intent filter needed). */
  fun launchIntent(context: Context): Intent {
    val launch = context.packageManager.getLaunchIntentForPackage(context.packageName)
    return Intent(ACTION_SEARCH)
      .setPackage(context.packageName)
      .apply { launch?.component?.let { component = it } }
      .addFlags(Intent.FLAG_ACTIVITY_NEW_TASK or Intent.FLAG_ACTIVITY_CLEAR_TOP)
  }

  fun pendingIntent(context: Context): PendingIntent =
    PendingIntent.getActivity(
      context,
      REQUEST_CODE,
      launchIntent(context),
      PendingIntent.FLAG_UPDATE_CURRENT or PendingIntent.FLAG_IMMUTABLE,
    )

  fun views(context: Context): RemoteViews =
    RemoteViews(context.packageName, R.layout.vidorax_search_widget).apply {
      setOnClickPendingIntent(R.id.vidorax_search_widget_bar, pendingIntent(context))
    }

  fun renderAll(context: Context, ids: IntArray? = null) {
    val manager = AppWidgetManager.getInstance(context)
    val all = ids ?: manager.getAppWidgetIds(ComponentName(context, SearchWidgetProvider::class.java))
    for (id in all) manager.updateAppWidget(id, views(context))
  }

  /** True once per intent that came from the widget (a JS reload doesn't open another tab). */
  fun takeSearchTap(intent: Intent?): Boolean {
    if (intent == null || intent.action != ACTION_SEARCH || intent.getBooleanExtra(EXTRA_CONSUMED, false)) return false
    intent.putExtra(EXTRA_CONSUMED, true)
    return true
  }
}
