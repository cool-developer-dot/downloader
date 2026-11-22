package com.vidorax.media.watch

import android.app.NotificationChannel
import android.app.NotificationManager
import android.app.PendingIntent
import android.content.Context
import android.content.Intent
import android.net.Uri
import android.os.Build
import com.vidorax.media.model.EnqueueRequest
import com.vidorax.media.model.RequestContext
import com.vidorax.media.model.SiteId
import com.vidorax.media.model.SourceKind
import java.util.UUID

/**
 * Checks the watched links that are due (#362, #504, #363): a change is announced in a notification and, when the
 * link asks for it, downloaded — a changed file again, a feed's new videos one by one (at most [MAX_AUTO_PER_RUN] per
 * run, through the engine's own duplicate check). A page's change is only announced: which video to take is the
 * user's choice in the browser. The first check of a link only records what it saw.
 */
internal class WatchRunner(
  private val store: WatchStore,
  private val checker: LinkChecker,
  /** Hands one download to the engine (its own duplicate check applies); throws when it cannot. */
  private val enqueue: suspend (EnqueueRequest) -> Unit,
  private val rules: () -> BulkRules,
  private val notify: (WatchedLink, String) -> Unit,
  private val now: () -> Long = System::currentTimeMillis,
) {
  /** What [checkNow] reports for one link. */
  data class Outcome(val link: WatchedLink, val changed: Boolean, val newItems: List<FeedItem>, val queued: Int)

  suspend fun runDue(): List<Outcome> = store.list().filter { it.isDue(now()) }.mapNotNull { checkNow(it.id) }

  suspend fun checkNow(id: String): Outcome? {
    val link = store.find(id) ?: return null
    val result = checker.check(link.url, link.kind)
    val checkedAt = now()
    if (result.fingerprint == null) {
      return Outcome(store.update(id) { it.copy(lastCheckedAt = checkedAt, lastStatus = result.status) } ?: link, false, emptyList(), 0)
    }
    val first = link.fingerprint == null
    val changed = !first && result.fingerprint != link.fingerprint
    val knownIds = link.items.map { it.id }.toSet()
    val newItems = if (first || link.kind != WatchKind.FEED) emptyList() else result.items.filter { it.id !in knownIds }
    var queued = 0
    if (changed && link.autoDownload && result.status == "ok") {
      when (link.kind) {
        WatchKind.FILE -> if (download(link.url, link.title, link.url)) queued += 1
        WatchKind.FEED -> {
          val allowed = rules()
          for (item in newItems.filter { allowed.allows(it.mediaUrl) }.take(MAX_AUTO_PER_RUN)) {
            if (download(item.mediaUrl, item.title, link.url)) queued += 1
          }
        }
        WatchKind.PAGE -> Unit
      }
    }
    val updated = store.update(id) {
      it.copy(
        fingerprint = result.fingerprint,
        lastCheckedAt = checkedAt,
        lastChangedAt = if (changed) checkedAt else it.lastChangedAt,
        lastStatus = result.status,
        title = it.title ?: result.title,
        items = if (link.kind == WatchKind.FEED) result.items.take(WatchedLink.MAX_ITEMS) else it.items,
      )
    } ?: link
    if (changed && (link.kind != WatchKind.FEED || newItems.isNotEmpty())) {
      notify(updated, if (link.kind == WatchKind.FEED) "items:${newItems.size}:$queued" else if (queued > 0) "downloading" else "changed")
    }
    return Outcome(updated, changed, newItems, queued)
  }

  private suspend fun download(url: String, title: String?, pageUrl: String): Boolean = runCatching {
    enqueue(
      EnqueueRequest(
        url = url,
        // The engine's probe decides: a playlist or a manifest behind the link is downloaded as the stream it is.
        kind = SourceKind.PROGRESSIVE,
        manifestText = null,
        audioUrl = null,
        variant = null,
        request = RequestContext(null, pageUrl, null, emptyMap(), useCookies = false),
        title = title ?: url.substringAfterLast('/').substringBefore('?').ifBlank { url },
        site = SiteId.WEB,
        pageUrl = pageUrl,
        thumbnailUrl = null,
        durationMs = null,
        estimatedBytes = null,
        qualityLabel = null,
        saveToGallery = null,
      ),
    )
    true
  }.getOrDefault(false)

  companion object {
    const val MAX_AUTO_PER_RUN = 10

    fun newLink(url: String, kind: WatchKind, title: String?, intervalHours: Int, autoDownload: Boolean, now: Long) =
      WatchedLink(
        id = UUID.randomUUID().toString(),
        url = url,
        kind = kind,
        title = title,
        intervalHours = intervalHours,
        autoDownload = autoDownload,
        createdAt = now,
      )
  }
}

/** The "Watched links" notifications: one per changed link, tapping opens the Watched links screen. */
internal object WatchNotifications {
  private const val CHANNEL = "vidorax_watched_links"

  fun post(context: Context, link: WatchedLink, what: String) {
    val manager = context.getSystemService(NotificationManager::class.java) ?: return
    if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.O) {
      manager.createNotificationChannel(
        NotificationChannel(CHANNEL, if (isUrdu(context)) "نظر میں رکھے لنک" else "Watched links", NotificationManager.IMPORTANCE_DEFAULT),
      )
    }
    val urdu = isUrdu(context)
    val title = link.title ?: link.url
    val text = when {
      what.startsWith("items:") -> {
        val (count, queued) = what.removePrefix("items:").split(":").map { it.toIntOrNull() ?: 0 }
        if (urdu) "$count نئی ویڈیوز" + (if (queued > 0) "، $queued ڈاؤن لوڈ ہو رہی ہیں" else "")
        else "$count new videos" + (if (queued > 0) ", $queued downloading" else "")
      }
      what == "downloading" -> if (urdu) "بدل گیا، دوبارہ ڈاؤن لوڈ ہو رہا ہے" else "Changed, downloading again"
      else -> if (urdu) "یہ لنک بدل گیا ہے" else "This link has changed"
    }
    val open = Intent(Intent.ACTION_VIEW, Uri.parse("vidorax://watched-links")).setPackage(context.packageName)
      .addFlags(Intent.FLAG_ACTIVITY_NEW_TASK)
    val pending = PendingIntent.getActivity(context, link.id.hashCode(), open, PendingIntent.FLAG_IMMUTABLE or PendingIntent.FLAG_UPDATE_CURRENT)
    val builder = (if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.O) android.app.Notification.Builder(context, CHANNEL) else android.app.Notification.Builder(context))
      .setSmallIcon(android.R.drawable.stat_notify_sync)
      .setContentTitle(title)
      .setContentText(text)
      .setContentIntent(pending)
      .setAutoCancel(true)
    runCatching { manager.notify(NOTIFICATION_BASE + (link.id.hashCode() and 0xFFF), builder.build()) }
  }

  private fun isUrdu(context: Context): Boolean =
    runCatching { context.getSharedPreferences("vidorax-media-settings", Context.MODE_PRIVATE).getString("language", "en") == "ur" }
      .getOrDefault(false)

  private const val NOTIFICATION_BASE = 0x6000
}
