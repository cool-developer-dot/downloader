# Work log — Faran's File Manager packages (F12–F17)

The File Manager split (2026-11-25): Hamza builds F1–F11 (the screens, 70%), Faran builds F12–F17 (the engine and
backends, 30%) and integrates. Plans and status: the two Claude Docs (Hamza's and Faran's). Branch
`faran/F12-F17-files-core`, from `integration/files` (`b5ccdd1`).

## 2026-11-26

Before any build: the malware check failed — the node trojan was back (third time; `~/.node_modules`, npm `cli.js`
line 13, runner PID 337 from `~/Downloads/MDCAT`). Contained on the owner's word: process stopped, folder moved to
`~/QUARANTINE-node-trojan-2026-11-26/`, npm `cli.js` replaced from the registry tarball (sha512 matched). Whole-Mac
sweep clean (no process, connection, startup item, profile hook or repo payload). Source still unknown.

| Package | Commit | Checklist rows | What was built |
| --- | --- | --- | --- |
| F12 Files data engine | `d55ae12` | 771, 772, 834, 835, 973 | `src/files/api.ts` (the contract sent to Hamza), pure engine (file types, folder tree, listing/sort, folder stats, type counts), app DB v11 `media_folders.parent_id` with names unique per parent (skipped on databases without the table), nested create/move, delete moves items and subfolders up. |
| F13 Recycle bin backend | `204786b` | 801 | `src/files/trash/*`: bin on by default (30 days; 7/14/30/60/until emptied). A binned file stays on disk, untouched, and is hidden (library exclusion + Downloads order); restore is exact; purge = "Delete from VidoraX". Startup install + purge every 6 h. Player tab and Player page Delete go to the bin. |
| F14 Duplicates, clean, low space | `ba15c95` | 819, 852, 853, 855 | `src/files/cleanup/*`: size-first duplicate scan with the engine's stored SHA-256 (cancellable), one-tap clean (cache, temp, leftover parts, expired bin), low space alert (1 GB default, once a day, startup/resume/new download). New catalog `filesCore`. |
| F16 Open from other apps | `aa989ba` | 873, 947 | Manifest guard test; `OpenWithVidoraXRow` (opens app info → Open by default) for F2's page. |
| F15 SD card & Folders I added | see below | — (design 26/27) | Native `FolderAccess.kt` (`listGrantedFolders`, `listFolderDocuments`, one DocumentsContract query), `src/files/folder-access/*`, two screens (`/files/added-folders`, `/files/added-folder`), chips on the Files tab, `FolderAccessSettingsRow` for F2. Read-only: browse, play in place, import. |
| F17 Backup format | `68a0095` | 930, 932, 936 | `vidorax.appBackup` v2 `files` section (folders, item folders, tags, notes, bin/low-space settings, registered `vidorax.files.*` keys); Merge/Replace; v1 files still restore. |

Differences from the plan in Faran's doc, and why:

- **F13 has no native schema v8 and moves no files.** Binned items stay in place and are hidden in JS. That keeps
  every native query unchanged, makes Restore exact (row, thumbnail, tags, notes, folder, favorite, position), and
  purging reuses the tested delete path. Space is freed when the bin is emptied or the keep time ends.
- **F12 `storageSpace` and F14 need no native code**: the JS storage scan and the engine's stored checksums
  already give what is needed.
- **F17 matches items by library id** (like playlists), not by `identity_key`.

### Gates (JS, after F17)

- `tsc --noEmit`: 0 errors
- `eslint . --quiet`: 0 errors
- JS tests: 2,751 / 2,751 pass (`integration/files` had 2,713)

### Native tests

`:vidorax-media:testReleaseUnitTest`: 1,255 / 1,255 pass (3 new: `FolderAccessTest`). Gradle hung once on a slow
repository; re-run with HTTP timeouts.

### Device test (release APK `5890419`, Android Studio emulator Pixel 8 / Android 16, installed over the 1.2.0-based
`b5ccdd1` build with its data)

| Step | Expected | Result |
| --- | --- | --- |
| Update over `b5ccdd1` with data | App DB v10 → v11 runs; no crash; library intact | PASS — no FATAL / JS error in logcat, Player tab still 1 video |
| Permissions | Same as before | PASS — `aapt dump permissions` identical (38 entries) |
| Files tab chips (F15) | "SD card" and "Folders I added" open the new pages | PASS |
| Add folder (F15) | System picker → Movies → Allow → listed as "Phone storage" | PASS |
| Browse (F15) | Subfolders first, then files with sizes; subfolder opens | PASS (Clips › quiet-copy.mp4) |
| Play in place (F15) | Video plays from the picked folder, no copy; mini player continues | PASS |
| Import (F15) | Folder's videos copied into VidoraX, duplicates skipped | PASS — "3 copied. 2 were already saved."; Player tab 1 → 4 videos |
| Delete → bin (F13) | Player tab Delete hides the video; still hidden after force-stop + relaunch | PASS — 4 → 3, still 3 after restart |
| Backup v2 (F17) | "Back up all data" writes `vidorax.appBackup` v2 with a `files` section | PASS — sections settings, preferences, playlists, videoBookmarks, playStats, files; bin {on, 30}, lowSpace {on, 1 GB} |
| Low space (F14) | Under 1 GB free: one notification; not again the same day | PASS — "Phone storage is low · 848.7 MB left…" on its own "Low storage" channel; relaunch posted none |

Found and fixed during the device test (`a3f5b4a`): the picked-folder screen had no side gutter; "1 items" → "1 item".

Not testable on a device yet (no screen until Hamza's packages): Restore / Empty bin / Undo (F8), duplicates and
one-tap clean (F9), nested folder create/move (F1), restore of a v2 backup's `files` section (F11). Their logic is
covered by the unit tests above.
