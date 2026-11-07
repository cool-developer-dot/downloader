package com.vidorax.web.selection

import org.json.JSONException
import org.json.JSONTokener

/**
 * B8 — the rules for the app's items in a page's text-selection menu (pure, no Android views).
 *
 * The page's own menu is Android's: Chromium fills it with Cut / Copy / Paste / Share / Select all (+ text-processing
 * apps), and RNCWebViewHooks.wrapSelectionMenu lets [SelectionMenuCallback] add the app's items to it. Chromium's own
 * "Web search" item is dropped, because the app's Search uses the search engine chosen in Browser settings.
 *
 * The item list comes from JS (`setSelectionMenu`), so later packages add items (B22 "Save to notes", B23 "Highlight")
 * without native changes.
 */
object SelectionMenu {
  const val MAX_ITEMS = 4
  const val MAX_TITLE_LENGTH = 40
  /** The most selected text handed to JS; longer selections are cut (Search uses 300 characters). */
  const val MAX_TEXT_LENGTH = 20_000

  /** Chromium's resource entry name for its "Web search" item (`R.id.select_action_menu_web_search`). */
  const val CHROMIUM_WEB_SEARCH = "select_action_menu_web_search"

  private val ID_PATTERN = Regex("[a-z][A-Za-z0-9_]{0,31}")

  data class Item(val id: String, val title: String)

  /** The configuration JS gave: the items, and the script that reads the selection in the page. */
  data class Config(val items: List<Item>, val readScript: String)

  /**
   * The items JS asked for, in order: ids `[a-z][A-Za-z0-9_]{0,31}`, titles trimmed and 1–40 characters. A bad entry or
   * a repeated id is skipped; at most [MAX_ITEMS]. Lists of different lengths pair up to the shorter one.
   */
  fun sanitize(ids: List<String>, titles: List<String>): List<Item> {
    val seen = HashSet<String>()
    val items = ArrayList<Item>()
    for (index in 0 until minOf(ids.size, titles.size)) {
      val id = ids[index]
      val title = titles[index].trim()
      if (!ID_PATTERN.matches(id) || title.isEmpty() || title.length > MAX_TITLE_LENGTH || !seen.add(id)) continue
      items.add(Item(id, title))
      if (items.size == MAX_ITEMS) break
    }
    return items
  }

  /** Null clears the app's items (the menu is left exactly as Chromium makes it). */
  fun configOf(ids: List<String>, titles: List<String>, readScript: String): Config? {
    val items = sanitize(ids, titles)
    if (items.isEmpty() || readScript.isBlank()) return null
    return Config(items, readScript)
  }

  /** One item already in the menu: its id and, when the id is a resource, its entry name. */
  data class MenuEntry(val itemId: Int, val entryName: String?)

  /** The menu item ids to remove from what Chromium put in the menu: only its own "Web search". */
  fun idsToRemove(entries: List<MenuEntry>): List<Int> =
    entries.filter { it.entryName == CHROMIUM_WEB_SEARCH }.map { it.itemId }

  /**
   * The selected text from `WebView.evaluateJavascript`'s result (a JSON value): a non-blank string, cut to
   * [MAX_TEXT_LENGTH] without splitting a surrogate pair; anything else is null.
   */
  fun decodeSelection(raw: String?): String? {
    // evaluateJavascript gives valid JSON; only a quoted string is text (JSONTokener would read bare words too).
    if (raw.isNullOrBlank() || !raw.startsWith("\"")) return null
    val value = try {
      JSONTokener(raw).nextValue()
    } catch (_: JSONException) {
      return null
    }
    val text = value as? String ?: return null
    if (text.isBlank()) return null
    if (text.length <= MAX_TEXT_LENGTH) return text
    val end = if (Character.isHighSurrogate(text[MAX_TEXT_LENGTH - 1])) MAX_TEXT_LENGTH - 1 else MAX_TEXT_LENGTH
    return text.substring(0, end)
  }
}
