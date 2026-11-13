package com.vidorax.web.selection

import android.content.res.Resources
import android.graphics.Rect
import android.view.ActionMode
import android.view.Menu
import android.view.MenuItem
import android.view.View
import android.webkit.WebView

/**
 * B8 — wraps the text-selection menu callback Chromium gives a page's WebView: everything goes to Chromium's callback
 * (so Copy, Paste, Select all, Share and text-processing apps work as before, and the floating toolbar is placed by
 * it), and the app's items from [SelectionMenu.Config] are added. Chromium's "Web search" is removed.
 *
 * Tapping an app item reads the selection in the page with the configured script (the page's own selection only), then
 * closes the menu and hands the text to [onPick]. Nothing is given to the page.
 */
internal class SelectionMenuCallback(
  private val webView: WebView,
  private val delegate: ActionMode.Callback,
  private val config: SelectionMenu.Config,
  private val onPick: (itemId: String, text: String) -> Unit,
) : ActionMode.Callback2() {

  // Set once the menu is gone, so a menu the user already closed isn't finished again.
  private var destroyed = false

  override fun onCreateActionMode(mode: ActionMode, menu: Menu): Boolean {
    val created = delegate.onCreateActionMode(mode, menu)
    if (created) adjust(menu)
    return created
  }

  override fun onPrepareActionMode(mode: ActionMode, menu: Menu): Boolean {
    val changed = delegate.onPrepareActionMode(mode, menu)
    // Chromium may rebuild its items here (a new selection inside an editable field); add ours back if so.
    return adjust(menu) || changed
  }

  override fun onActionItemClicked(mode: ActionMode, item: MenuItem): Boolean {
    if (item.groupId != GROUP_ID) return delegate.onActionItemClicked(mode, item)
    val picked = config.items.getOrNull(item.itemId - FIRST_ITEM_ID) ?: return true
    // The menu is closed only after the page has answered: Chromium clears the page's selection when its menu goes,
    // and the script would then read nothing. The callback runs on the main thread.
    webView.evaluateJavascript(config.readScript) { raw ->
      if (!destroyed) mode.finish()
      SelectionMenu.decodeSelection(raw)?.let { onPick(picked.id, it) }
    }
    return true
  }

  override fun onDestroyActionMode(mode: ActionMode) {
    destroyed = true
    delegate.onDestroyActionMode(mode)
  }

  override fun onGetContentRect(mode: ActionMode, view: View, outRect: Rect) {
    if (delegate is ActionMode.Callback2) {
      delegate.onGetContentRect(mode, view, outRect)
    } else {
      super.onGetContentRect(mode, view, outRect)
    }
  }

  /** Removes Chromium's Web search and adds the app's items when they are missing. True when the menu changed. */
  private fun adjust(menu: Menu): Boolean {
    var changed = false
    val entries = (0 until menu.size()).map { index ->
      val id = menu.getItem(index).itemId
      SelectionMenu.MenuEntry(id, entryNameOf(id))
    }
    for (id in SelectionMenu.idsToRemove(entries)) {
      menu.removeItem(id)
      changed = true
    }
    config.items.forEachIndexed { index, item ->
      val id = FIRST_ITEM_ID + index
      if (menu.findItem(id) == null) {
        menu.add(GROUP_ID, id, ITEM_ORDER + index, item.title)
          .setShowAsAction(MenuItem.SHOW_AS_ACTION_IF_ROOM)
        changed = true
      }
    }
    return changed
  }

  private fun entryNameOf(id: Int): String? {
    if (id == View.NO_ID || id == 0) return null
    return try {
      webView.resources.getResourceEntryName(id)
    } catch (_: Resources.NotFoundException) {
      null
    }
  }

  companion object {
    // Ids and group outside Android's (0x0102…) and Chromium's (resource ids, 0x7f… or a shared-library package).
    internal const val GROUP_ID = 0x0B08
    internal const val FIRST_ITEM_ID = 0x0B0800
    // After Chromium's own items (it orders them from 1), before the text-processing apps it adds at 100 and up.
    private const val ITEM_ORDER = 50
  }
}
