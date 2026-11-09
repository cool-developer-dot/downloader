/**
 * B8 — the script VidoraWeb runs in the page when an app item of the text-selection menu is tapped. It only reads what
 * the user selected and returns it as a string: nothing from the app goes into the page.
 *
 * - A selection inside a text field (`<textarea>`, `<input>` of type text / search / url / tel) is read from the field
 *   (`window.getSelection()` is empty there). Password fields and every other input type are never read.
 * - Otherwise the page's selection (`window.getSelection()`, which also covers contenteditable).
 * - At most 20,000 characters; '' when there is nothing (or the page broke something).
 * - B23 #261 (additive): for page text it also leaves the selection's anchor — the exact text as the page's text
 *   nodes give it, with up to 32 characters before and after — in `window.__vidoraxSelectionContext` (the page's own
 *   text, nothing from the app). The Highlight item reads it back with ANCHOR_REQUEST_SCRIPT; the returned text is
 *   unchanged for every item.
 */

/** Matches `SelectionMenu.MAX_TEXT_LENGTH` in Kotlin. */
export const SELECTION_TEXT_MAX = 20_000;

export const SELECTION_READ_SCRIPT = `(function () {
  var MAX = ${SELECTION_TEXT_MAX};
  var text = '';
  try { window.__vidoraxSelectionContext = null; } catch (e) {}
  try {
    var el = document.activeElement;
    var tag = el && el.tagName ? String(el.tagName).toUpperCase() : '';
    var type = tag === 'INPUT' ? String(el.type || 'text').toLowerCase() : '';
    var readable = tag === 'TEXTAREA' || (tag === 'INPUT' && /^(text|search|url|tel)$/.test(type));
    if (readable) {
      var start = el.selectionStart;
      var end = el.selectionEnd;
      if (typeof start === 'number' && typeof end === 'number' && end > start) {
        text = String(el.value).slice(start, end);
      }
    }
  } catch (e) {
    text = '';
  }
  if (!text) {
    try {
      var selection = window.getSelection ? window.getSelection() : null;
      text = selection ? String(selection) : '';
    } catch (e) {
      text = '';
    }
    try {
      if (text && selection && selection.rangeCount > 0 && document.body) {
        var range = selection.getRangeAt(0);
        var before = document.createRange();
        before.setStart(document.body, 0);
        before.setEnd(range.startContainer, range.startOffset);
        var after = document.createRange();
        after.setStart(range.endContainer, range.endOffset);
        after.setEnd(document.body, document.body.childNodes.length);
        window.__vidoraxSelectionContext = {
          exact: String(range).slice(0, 2000),
          prefix: String(before).slice(-32),
          suffix: String(after).slice(0, 32)
        };
      }
    } catch (e) {}
  }
  if (typeof text !== 'string') return '';
  return text.length > MAX ? text.slice(0, MAX) : text;
})();`;
