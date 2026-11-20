# VidoraX Bridge — browser extension (P6 #500)

A Manifest V3 extension for **Chrome, Edge and Firefox** that sends links and videos from the computer's browser to
VidoraX on the user's Android phone, over their own Wi-Fi. It talks only to the phone address the user types in;
there is no server of ours and no analytics.

- **Pairing:** the popup asks for the phone's address and PIN (VidoraX → Settings → Downloads → Remote control). The
  browser then asks permission for that one address (`optional_host_permissions`), and the phone issues a token that
  the extension keeps in `storage.local`.
- **Context menu:** "Send link / video / page to VidoraX". A `<video>` whose address is a `blob:` (MediaSource) player
  sends the page instead, which VidoraX reads for its video.
- **Popup:** the current page's video links (`<video>`/`<source>` addresses and links ending in a video extension),
  each with "Send", plus "Send this page". Reading the page uses `activeTab` + `scripting` only when the popup opens.
- **Words:** English and Urdu (by the browser's language), from `lib/strings.mjs` — Chrome's `_locales` has no Urdu.

Every link goes through VidoraX's own Batch Add path on the phone, so YouTube, DRM and audio-only stay refused there.

## Files

| File | What |
| --- | --- |
| `manifest.json` | One manifest for all three browsers: `background.service_worker` (Chrome/Edge) and `background.scripts` (Firefox) side by side; `browser_specific_settings.gecko` for Firefox. |
| `background.js` | Context-menu items and the toolbar badge (✓ / !). |
| `popup.html`, `popup.mjs`, `popup.css` | Pairing and the page's video links. |
| `lib/core.mjs` | Pure logic (address, menu target, video links) — tested by `src/remote/extension-core.test.ts`. |
| `lib/api.mjs` | The phone's JSON API (`docs/REMOTE_API.md`). |
| `lib/strings.mjs` | English and Urdu. |
| `icons/` | 16/32/48/128 px PNGs. |
| `package.sh` | Builds the store ZIPs into `dist/`. |

Minimum versions: Chrome/Edge 123, Firefox 128.

## Try it unpacked

- **Chrome / Edge:** `chrome://extensions` (or `edge://extensions`) → Developer mode → **Load unpacked** → this folder.
- **Firefox:** `about:debugging#/runtime/this-firefox` → **Load Temporary Add-on…** → `manifest.json`.

Then on the phone turn on Remote control, click the extension's icon and type the address and PIN.

## Publishing (owner's step)

Run `bash extensions/vidorax-bridge/package.sh`. It writes `dist/vidorax-bridge-<version>.zip` (the same ZIP serves the
Chrome Web Store and Edge Add-ons) and `dist/vidorax-bridge-<version>-firefox.zip` (AMO). Store accounts, listings and
review are the owner's:

1. **Chrome Web Store** (developer account, one-time fee): upload the ZIP. Privacy tab:
   - single purpose: "Send links from the browser to the user's own VidoraX phone app on their local network";
   - permission reasons: `contextMenus` (the Send items), `storage` (the phone address and pairing token),
     `activeTab` + `scripting` (list the current page's video links when the popup opens), optional `http://*/*`
     (asked for the single phone address at pairing);
   - data use: no data collected or sent to the developer.
2. **Edge Add-ons** (Partner Center): the same ZIP and answers.
3. **Firefox AMO**: upload the `-firefox` ZIP. `data_collection_permissions` is already `none`. AMO may ask for the
   source: the extension is plain, unminified JavaScript, so the ZIP is the source.

Bump `version` in `manifest.json` for every store upload.
