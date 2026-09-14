# Unified Browser Phase 1 — Architecture

## 1. Previous Home + Browser split

Before Phase 1, VidoraX had two landing-adjacent surfaces:

| Surface | Route | Role |
|---------|-------|------|
| **Home** | `/` (`(tabs)/index`) | Dashboard: Paste Link, Open Browser, Quick Access, Active/Recent Downloads, Continue Watching, Recently Watched, Storage |
| **Browser** | `/browser` | Real browser: omnibox, tabs, WebViews, start page (`vidorax://home`), media CTA |

Users launched into **Home** after splash/onboarding. Browser was a separate tab.

## 2. New unified model

**Browser is both the app landing page and the real browser.**

| State | UI |
|-------|-----|
| No webpage open (`vidorax://home`) | Minimal start page under existing Browser chrome |
| Navigation begun | Existing WebView / browser content |

No dashboard. Downloads / Library / Settings stay on their own tabs.

## 3. Final bottom navigation

1. Browser (default)
2. Downloads
3. Library
4. Settings

Home is **not** a visible tab (`href: null`).

## 4. Default launch route

```
Splash → Onboarding (cinematic) → replace(/browser)
```

App Lock unlocks in place (unchanged). After cold launch + unlock, the user is on Browser.

## 5. Start-page responsibility

`BrowserHomeView` shows only:

- Left-aligned VidoraX intro + short subtitle
- Compact **3×3** Quick Access (9 non-YouTube sites)
- Intentional whitespace below (no dashboard fill)

Chrome above (tabs badge, omnibox, overflow) remains `BrowserHeader`.

Removed from landing: Paste Link, Open Browser, Analyze, Active/Recent Downloads, Continue Watching, Recently Watched, Storage, permanent History, bookmarks dashboard tabs.

## 6. Omnibox reuse

Single omnibox: `AddressBar` → `useAddressBar` → `navigationService.resolveSubmission` → `classifyNavigationInput` → `loadUrlActiveTab`.

No second URL parser.

## 7. Quick Access reuse

- Full registry: `QUICK_SITES` (YouTube **removed** from promoted registry)
- Start page subset: `START_PAGE_QUICK_SITES` (exactly 9 non-YouTube entries)
- Opens via `loadUrlActiveTab` (same path as omnibox)

## 8. WebView preservation

- `BrowserContainer` still mounts `MountedTabWebView` with `key={tabId}`
- Start page overlays when `selectIsHome`; WebViews stay mounted/hidden
- No cookie/history/tab/media resets

## 9. Tab preservation

- `MAX_OPEN_TABS = 8`
- `MAX_MOUNTED_WEBVIEWS = 2`
- Same tab store, switcher, overflow new-tab / close

## 10. Route compatibility

| Path | Behavior |
|------|----------|
| `/` | Thin `Redirect` → `/browser` |
| `/browser` | BrowserScreen |
| Deep links to `/` | Hit redirect |

`routePaths.home` kept as `'/'` for legacy constants; prefer `routePaths.browser`.

**Changed references:**

- Onboarding finish → `routePaths.browser`
- Tab exit double-back → `routePaths.browser`
- Tabs `initialRouteName` → `browser`
- Visible tab order → Browser first; Home `href: null`

## 11. App Lock integration

No App Lock / security-store changes. Gate still wraps `(app)`. Unlock does not navigate; launch already targets Browser.

## 12. Theme integration

Start page uses `useTheme()` semantic tokens (`background`, text variants, `card`, `border`, `surfacePressed`). No local LIGHT/LOGO/DARK forks. Logo brand red `#DC3C2C` unchanged.

## 13. Feature-isolation boundaries

Phase 1 / start-page UX does **not** touch:

- Download engine / scheduler / HLS / pause-resume
- Media detection / TikTok / Instagram / cookie / SSL / navigation policy
- Player / export / App Lock / theme architecture
- Downloads / Library / Settings internals (Phase 3+ relocation)

Legacy `HomeScreen` files remain on disk for later relocation; they are not mounted as the landing route.

## 14. Manual Android acceptance plan

See: `docs/testing/UNIFIED-BROWSER-PHASE1-REAL-ANDROID-ACCEPTANCE.md`

Static gate: `npm run verify:unified-browser-phase1`

---

## START PAGE UX CONTRACT

### 1. Compact hierarchy

Top-anchored (not vertically centered):

1. Browser chrome: Tabs · Omnibox · Overflow  
2. Intro: **VidoraX** + subtitle  
3. **Quick Access** heading  
4. 3×3 shortcut grid  
5. Intentional empty space  
6. Compact browser toolbar (Back / Forward / Home)  
7. Bottom tabs

### 2. Exact visible Quick Access list (9)

1. Instagram  
2. TikTok  
3. Facebook  
4. Vimeo  
5. Dailymotion  
6. Reddit  
7. Pinterest  
8. Telegram  
9. X  

### 3. 3×3 grid

`QUICK_ACCESS_COLUMNS = 3`, `START_PAGE_QUICK_ACCESS_COUNT = 9`, density `startPage`.

### 4. YouTube product-surface removal policy

| Surface | Handling |
|---------|----------|
| `QUICK_SITES` / start-page grid | YouTube entry **removed** |
| Platform hub / onboarding orbit | YouTube promotion **removed** |
| Trust demo URL | Switched to `vimeo.com` example |
| User history / bookmarks | **Preserved** (never purged) |
| Generic `https://youtube.com` browse | **Allowed** via normal browser |
| Native `youtube:` / `vnd.youtube:` intents | Still blocked (containment) |
| Download metadata host→`YOUTUBE` labels | Left intact (classification only; not promotion) |

### 5. Generic browser preservation

No new YouTube URL blacklist for http(s). Manual navigation remains normal WebView behavior.

### 6. Spacing / sizing guidance

| Token | Target |
|-------|--------|
| Header padding | `px=16`, `py=12` |
| Content top | 20dp |
| Title → subtitle | 4dp |
| Subtitle → Quick Access | 24dp |
| Heading → grid | 12dp |
| Screen X padding | 20dp |
| Tile min height | 96dp |
| Icon | 36dp |
| Radius | 16dp |
| Grid gap | 12dp |

### 7. Toolbar density

`BROWSER_TOOLBAR_HEIGHT = 48` (within 48–56). Semantics unchanged.

### 8. Theme integration

LIGHT / LOGO / DARK via existing tokens. Cards stay light/charcoal surfaces — not brand-red fills.

### 9. Accessibility

Omnibox, tab badge, overflow, intro, and each shortcut (`accessibilityRole="button"` + platform name) labeled.

### 10. Fixed external icon colors

Favicons / platform brand artwork keep external brand colors; chrome follows VidoraX theme.

### 11. Feature-isolation boundaries

Start-page UX only — no WebView remount, tab store, media engine, downloader, or App Lock changes.
