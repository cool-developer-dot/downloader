# vidorax-media

Expo local module (Android) that owns downloads, the library, media files and their metadata. JavaScript reaches it
only through the contract in `src/VidoraMedia.types.ts` (`getVidoraMedia()` in `index.ts`). The design is in
docs/ARCHITECTURE.md section 3.

## Kotlin layout (`android/src/main/java/com/vidorax/media`)

| Path | Contents |
| --- | --- |
| `VidoraMediaModule.kt` | The Expo module: converts arguments, delegates, forwards events. No logic of its own. |
| `MediaServices.kt` | Process-wide services (database, paths, library, thumbnails, gallery, file actions, legacy import). |
| `MediaErrors.kt` | Coded rejections listed in the contract header. |
| `bridge/` | `Records.kt`: Expo `Record` inputs and their validation. `JsValues.kt`: outputs in the contract's shape. |
| `model/` | Plain Kotlin types for contract values, shared by every package. |
| `db/` | `MediaDatabase` (`noBackupFilesDir/vidorax-media.db`, WAL, IO dispatcher) and `Schema` with its migrations. |
| `library/` | `LibraryStore` (the `library` table and change events), `MediaInfo`, `Thumbnails`, `GalleryExport`, `StorageUsage`, `LegacyImport`, and the pure helpers they use: `LibrarySql`, `StoragePaths`, `FileNames`, `Titles`, `MediaTypes`, `LegacyLayout`. |
| `files/` | `VidoraFileProvider` (`${applicationId}.vidorax.files`) and `FileActions` (open with, share). |
| `player/` | `Volume`: media stream volume and its change broadcast. |
| `engine/` | `DownloadEngineApi`, what the module needs from the download engine, and `DownloadEngineProvider`, the one place an implementation is plugged in. Until then every download function rejects with `ERR_INVALID_STATE`. |

## Adding the download engine

Following docs/ARCHITECTURE.md section 3.2, networking goes in `net/`, probing and HLS/DASH planning in `plan/`,
transfers in `transfer/`, remuxing in `mux/`, the queue and runners in `engine/` and notifications in `notify/`.
The engine is an application-scoped singleton built from `MediaServices.get(context)`, returned by
`DownloadEngineProvider.get`. It owns the `downloads` and `parts` tables of `MediaDatabase` and work folders from
`StoragePaths.workDir`. A finished download becomes a library item through `StoragePaths.newLibraryFile`,
`MediaInfo.read`, `Thumbnails.create` and `LibraryStore.insert`; auto-save uses `GalleryExport.save(item)` followed by
`LibraryStore.setGalleryUri`.

## Tests

`bash scripts/dev/gradle.sh :vidorax-media:testDebugUnitTest` runs the JVM tests in `android/src/test`. They cover pure
logic only: SQL fragments, paths and names, input validation.
