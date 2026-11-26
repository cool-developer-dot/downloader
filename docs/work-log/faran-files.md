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
