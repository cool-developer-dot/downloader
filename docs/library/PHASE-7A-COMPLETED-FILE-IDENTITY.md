# Phase 7A — Completed File Identity

## 1. Pre-7A architecture

Phase 1 already owns transfer correctness:

`source → PREPARING → QUEUED → transfer → .part → validation → FINALIZING → canonical file → COMPLETED`

Canonical storage remains:

`VidoraXDownloads/{downloadId}/{fileName}`

inside app-private storage.

Before 7A:

- Filename chosen at enqueue (`resolveDownloadFileName` / quality metadata)
- Progressive writes `{name}.part`, then commits to the same final basename
- HLS may rewrite extension to `.ts` / `.mp4` from playlist container hint
- Catalog persisted `fileName`, `fileSize`, `downloadedAt`, title/thumbnail/quality
- `mime_type` column existed but was unused by `DownloadItem` / Library
- Library inferred MIME mostly from filename extension
- Completed Download cards still showed a 100% progress bar

## 2. Completed descriptor

Canonical conceptual model (implemented as `CompletedFileDescriptor`):

| Field | Meaning |
| --- | --- |
| `downloadId` | Stable job / Library / player id |
| `fileName` | Actual final basename |
| `canonicalPath` | App-private final URI when known |
| `mimeType` | Strongest proven MIME |
| `container` | `mp4` / `webm` / `ts` / `m4a` / `unknown` |
| `fileSize` | Actual finalized bytes when known |
| `completedAt` | Terminal completion timestamp (`downloadedAt`) |
| `displayTitle` | Human title (separate from filename) |
| `sourceHost` | Optional non-secret host |
| `mediaIdentity` | Optional non-secret content identity |
| `thumbnailUri` | Optional remote HTTP(S) poster only |
| `qualityLabel` | Only when genuinely known |

Authority: `src/downloads/completed-file/`

## 3. Naming policy

Priority:

1. Useful create-time stem (preserve when non-generic)
2. Sanitized trusted display title
3. Sanitized Content-Disposition basename (title only)
4. Social platform + completion date (`instagram_reel_YYYY-MM-DD`)
5. Source host + media type (+ proven quality)
6. `video_YYYY-MM-DD_{shortId}`

Deterministic. No `Math.random()`. Signed query / auth never enter filenames.

## 4. Sanitization

`sanitizeCompletedFileName`:

- strips URL → last path segment only (drops query/hash)
- removes `/ \ : * ? " < > |` and control chars
- blocks `.` / `..` / traversal residues
- bounds length (base ≤ 80, full ≤ 120)
- filename component only — never a path

## 5. MIME / container authority

Priority:

1. Phase 1 structural signature (`mp4` / `webm` / `ts` / …)
2. Trusted verified MIME
3. Worker / analysis container hint (not playlist)
4. Non-octet-stream response MIME
5. Existing file extension
6. URL extension (lowest)

`application/octet-stream` never overrides proven MP4/WebM.
`.m3u8` is never the completed artifact extension.

## 6. HLS behavior

7A does **not** rewrite HLS transfer.

Final descriptor uses actual Phase 1 artifact evidence:

- MPEG-TS assemble → `.ts` + `video/mp2t`
- fMP4 assemble → `.mp4` + `video/mp4`

No FFmpeg / remux added. No fake `.mp4` labeling of raw unsupported output.

## 7. Persistence

Extends existing download catalog (no second DB):

- Persists `mimeType` into existing `mime_type`
- Persists corrected `fileName`, `fileSize`, `downloadedAt`
- `container` derived from MIME on hydrate (no destructive migration)

Engine `completed` event now carries optional `fileName` / `mimeType` / `container`.

## 8. Legacy compatibility

- Missing MIME / container / title / thumbnail → safe fallbacks, no crash
- Ugly legacy basenames are **not** auto-renamed
- Missing physical file → `canPlay=false`, Library card disabled / “File unavailable”

## 9. Library state grouping

`classifyLibraryDownloadState`:

- **active_transitional** — PREPARING/QUEUED/DOWNLOADING/FINALIZING/PAUSED/RETRYING/…
- **completed** — COMPLETED
- **failed** — FAILED
- **cancelled** — CANCELLED

Phase 1 states are not redefined.

## 10. Action capabilities

`resolveCompletedActions`:

| Capability | 7A behavior |
| --- | --- |
| `canPlay` | true when COMPLETED + physical file present → existing player route |
| `canOpen` | capability only; Library does not expose dead Open |
| `canShare` | capability only; Library does not expose dead Share |
| `canDelete` | may follow existing remove paths on Downloads |
| `canExport` | false in 7A (Phase 7C) |

Downloads screen Open/Share remain **pre-existing** Expo `File.contentUri` handoff — not newly implemented FileProvider architecture in 7A.

## 11. Security / privacy

Completed descriptors never persist:

- Cookie / Authorization / OTP / password
- raw requestContext / Phase 6 ephemeral secrets
- signed URL query tokens in filenames or titles

`sourceUrl` may already exist on catalog (pre-7A). 7A does not broaden that into display/filename/identity fields.

## 12. Exact 7A boundaries

**Owns:** completed identity, naming, MIME/container, Library presentation, action capability model, Play handoff normalization.

**Does not own:** FileProvider redesign, Sharesheet, MediaStore export, notifications, public Downloads, deletion reliability semantics (7C), player redesign (8).

## 13. Manual acceptance

See:

`mobile/docs/testing/PHASE-7A-COMPLETED-FILE-IDENTITY-REAL-ANDROID-ACCEPTANCE.md`
