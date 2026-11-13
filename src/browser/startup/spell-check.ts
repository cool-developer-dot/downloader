/**
 * B21 #237 — spell check. On (default) changes nothing: fields work as today. Off:
 * - the app's own text fields get `autoCorrect={false}` / `spellCheck={false}` (on Android, `TYPE_TEXT_FLAG_NO_SUGGESTIONS`
 *   — no suggestions and no red underlines, as far as the keyboard follows it);
 * - pages get `SPELL_CHECK_OFF_PAGE_SCRIPT` at document start: `spellcheck="false"` on the document (inherited by every
 *   field) and `autocorrect="off"` on a field as it gets focus, so Chromium tells the keyboard not to check.
 * The address bar never checks spelling (it already sets `autoCorrect={false}`).
 */

export function spellCheckInputProps(enabled: boolean): { autoCorrect?: false; spellCheck?: false } {
  return enabled ? {} : { autoCorrect: false, spellCheck: false };
}

/** Constant: carries nothing from the app into the page. */
export const SPELL_CHECK_OFF_PAGE_SCRIPT = `(function () {
  try {
    if (window.__vidoraxSpellCheckOff) return;
    window.__vidoraxSpellCheckOff = true;
    var mark = function () {
      var root = document.documentElement;
      if (root) root.setAttribute('spellcheck', 'false');
      return !!root;
    };
    if (!mark()) {
      document.addEventListener('readystatechange', mark, { once: true });
    }
    document.addEventListener(
      'focusin',
      function (event) {
        var el = event.target;
        if (!el || !el.setAttribute) return;
        var tag = String(el.tagName || '').toUpperCase();
        if (tag === 'INPUT' || tag === 'TEXTAREA' || el.isContentEditable) {
          el.setAttribute('spellcheck', 'false');
          el.setAttribute('autocorrect', 'off');
        }
      },
      true,
    );
  } catch (e) {}
})();`;
