/**
 * B12 #115 Do Not Track — what pages can read: `navigator.doNotTrack` is "1" and `navigator.globalPrivacyControl` is
 * true (the newer signal most privacy laws name). A fixed script with no data from the app, run at document start.
 */
export const DO_NOT_TRACK_PAGE_SCRIPT = `(function () {
  try {
    var define = function (name, value) {
      try { Object.defineProperty(Navigator.prototype, name, { configurable: true, get: function () { return value; } }); } catch (e) {}
    };
    define('doNotTrack', '1');
    define('globalPrivacyControl', true);
  } catch (e) {}
})();`;

/** Request headers sent with the pages the browser opens itself (a typed address, a tab restored, a reload). */
export const DO_NOT_TRACK_HEADERS: Readonly<Record<string, string>> = { DNT: '1', 'Sec-GPC': '1' };
