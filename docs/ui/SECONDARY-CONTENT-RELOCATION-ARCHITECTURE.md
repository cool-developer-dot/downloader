# Secondary Content Relocation — Architecture

Phase 3 information architecture: Browser stays a browsing surface. Secondary dashboard content is reached from the existing overflow menu as **shortcuts**, then rendered by the existing authoritative screen for that domain.

This phase does not add persistence, download-engine behavior, WebView/tab behavior, App Lock, or player/file actions.

## 1. Final app information architecture

| Surface | Responsibility |
| --- | --- |
| **Browser** | Search/paste, Quick Access, webpage, automatic **Video available**, browser controls |
| **⋮ overflow** | Routing shortcuts only |
| **Downloads** | Download jobs and existing filters |
| **Library** | Local/downloaded media, Continue Watching, Recently Watched |
| **Settings** | Appearance, privacy/App Lock, download settings, **Storage**, language, legal |

Bottom tabs remain **Browser / Downloads / Library / Settings**. Legacy `/` still redirects to Browser.

## 2. Browser responsibility

The start page stays minimal:

- compact VidoraX intro
- compact 3×3 Quick Access
- optional **Video available** bar (Phase 2) when a verified source exists
- existing chrome: tab count, omnibox, overflow, back/forward/home-reload

Browser does **not** host Active Downloads, Recent Downloads carousels, Continue Watching, Recently Watched, Storage, or permanent History/Bookmarks blocks.

## 3. Overflow shortcuts

The existing `BrowserOverflowMenu` is the only menu. New items are actions that:

1. `requestSecondaryDestination(...)` with an existing filter key
2. `navigation.navigate` / `push` to an existing route

They do not read download lists, playback summaries, or storage totals.

Suggested grouping (dividers, no extra headers):

- Active Downloads, Recent Downloads
- Continue Watching, Recently Watched
- History, Bookmarks
- existing utilities: New tab, Add bookmark, Copy, Share, Desktop site, Open external, Settings

## 4. Downloads responsibility

Downloads remains the job list. Canonical execution states are unchanged (`PREPARING` … `CANCELLED`).

Overflow:

- **Active Downloads** → Downloads + existing UI filter `running` (maps to catalog `DOWNLOADING`)
- **Recent Downloads** → Downloads + existing UI filter `completed`, sort `newest`

Queued/Paused/Failed remain the existing Downloads filters. This phase does not invent a combined “all non-terminal” filter.

## 5. Library responsibility

Library remains media consumption (local files, play, share/export via existing actions).

Overflow:

- **Continue Watching** → Library filter `all` (existing `ContinueWatchingSection` at the top)
- **Recently Watched** → Library filter `recently_watched`

Data: existing `useContinueWatchingQuery` / `useRecentPlaybackQuery`. No new watch-history store.

## 6. Settings responsibility

Existing Settings root is unchanged. Conceptual order already includes Appearance, language, Download Settings, **Storage**, support, privacy/App Lock, legal.

## 7. Storage relocation

Storage already lives at **Settings → Storage** (`StorageSection` → `routePaths.storage` → `StorageScreen` + `useStorageManager` / device-storage service).

Overflow does not add a Storage card on Browser. Opening Storage does not delete files or change downloader paths.

## 8. History / Bookmarks ownership

- Browser history: existing history route/store (`routePaths.history`)
- Bookmarks: existing bookmarks route/store (`routePaths.bookmarks`)
- Add bookmark in the overflow still writes the existing bookmarks store

No copy, migration, or retention-policy change.

## 9. Continue / Recently Watched ownership

Authoritative UI is Library (plus existing Watch History “see all” from Continue Watching). Home dashboard components that presented the same data remain on disk but are **not mounted**.

## 10. Old Home cleanup

`HomeScreen` is not the landing experience. `src/app/(app)/(tabs)/index.tsx` redirects `/` to Browser; the Home tab uses `href: null`.

Home presentation files stay on disk so shared derive helpers (`home-derive`, local file index) and prior verifiers are not deleted blindly. Shared services used by Storage Manager are kept.

## 11. Route compatibility

Preserved:

- `routePaths.home` (`/`) → Browser redirect
- Browser / Downloads / Library / Settings tabs
- history, bookmarks, storage, watch-history, player, App Lock, onboarding

Overflow uses existing `navigation.navigate` / `push`. Intent is in-memory and one-shot (not a URL param schema).

## 12. No-duplicate-data rule

| Domain | Source of truth |
| --- | --- |
| Download jobs | existing downloads store / engine |
| Library media | existing library/file catalog |
| Continue Watching | existing playback-progress queries |
| Recently Watched | existing watch-history queries |
| Browser history | existing history store |
| Bookmarks | existing bookmarks store |
| Storage | existing storage-manager / filesystem services |

`secondary-destination-intent.ts` holds only `{ domain, filter }` routing keys.

## 13. Phase 2 preservation

Automatic detection, verified-only **Video available**, Play, Download, quality sheet, and CTA lifecycle (`NONE` / `AVAILABLE` / `HANDOFF_IN_PROGRESS` / `CONSUMED`) are untouched.

## 14. Feature-isolation boundaries

This phase must not modify:

- downloader Range/HLS/pause/resume/retry/scheduler/finalization/notifications
- WebView keys, cookies, sessions, UA, navigation policy, media detection, tab mount pool
- App Lock PIN/recovery/throttle/SecureStore
- player engine / URI / resume
- `content://` open/share/export

Theme architecture and `#DC3C2C` are unchanged. EN/UR catalogs gained overflow shortcut strings only.

## 15. Android acceptance plan

See `docs/testing/SECONDARY-CONTENT-RELOCATION-REAL-ANDROID-ACCEPTANCE.md`.

Static gate: `npm run verify:secondary-content-relocation`.
