package com.vidorax.media.watch

import android.content.Context
import org.json.JSONObject

/**
 * #505 Include/Exclude rules as the background feed downloads apply them (the same rules the app's Batch Add applies;
 * JavaScript sends them here whenever they change). Size rules need a probe and are left to the engine's own checks:
 * a feed item is only refused here by its link.
 */
internal data class BulkRules(
  val includeExtensions: List<String> = emptyList(),
  val excludeExtensions: List<String> = emptyList(),
  val includeKeywords: List<String> = emptyList(),
  val excludeKeywords: List<String> = emptyList(),
  val includePattern: String = "",
  val excludePattern: String = "",
) {
  fun allows(url: String): Boolean {
    val lower = url.lowercase()
    val ext = runCatching { java.net.URI(url).path.substringAfterLast('/').substringAfterLast('.', "").lowercase() }.getOrDefault("")
    if (includeExtensions.isNotEmpty() && ext !in includeExtensions) return false
    if (ext.isNotEmpty() && ext in excludeExtensions) return false
    if (includeKeywords.isNotEmpty() && includeKeywords.none { lower.contains(it.lowercase()) }) return false
    if (excludeKeywords.any { lower.contains(it.lowercase()) }) return false
    regex(includePattern)?.let { if (!it.containsMatchIn(url)) return false }
    regex(excludePattern)?.let { if (it.containsMatchIn(url)) return false }
    return true
  }

  private fun regex(source: String): Regex? =
    source.takeIf { it.isNotBlank() }?.let { runCatching { Regex(it, RegexOption.IGNORE_CASE) }.getOrNull() }

  companion object {
    private const val PREFS = "vidorax_watches"
    private const val KEY = "rules"

    fun fromJson(json: String?): BulkRules = runCatching {
      val o = JSONObject(json ?: return BulkRules())
      fun list(name: String) = o.optJSONArray(name)?.let { a -> (0 until a.length()).map { a.optString(it).lowercase().trim() }.filter { it.isNotEmpty() } }.orEmpty()
      BulkRules(
        list("includeExtensions"),
        list("excludeExtensions"),
        list("includeKeywords"),
        list("excludeKeywords"),
        o.optString("includePattern"),
        o.optString("excludePattern"),
      )
    }.getOrDefault(BulkRules())

    fun load(context: Context): BulkRules =
      fromJson(runCatching { context.getSharedPreferences(PREFS, Context.MODE_PRIVATE).getString(KEY, null) }.getOrNull())

    fun save(context: Context, json: String) {
      context.getSharedPreferences(PREFS, Context.MODE_PRIVATE).edit().putString(KEY, json).apply()
    }
  }
}
