# Phase 7A — Completed File Identity — Real Android Acceptance

All runtime cases start as **NOT_TESTED**.

Static/code verification does **not** prove device filesystem, playback, or visual quality.

---

## A. DIRECT MP4

### 1. Download a valid direct MP4

| Field | Value |
| --- | --- |
| Status | NOT_TESTED |
| Expected | Phase 1 COMPLETED → useful filename → `.mp4` → `video/mp4` → actual physical size → completed Library card |

---

## B. INSTAGRAM

### 2. Download a valid supported Instagram video

| Field | Value |
| --- | --- |
| Status | NOT_TESTED |
| Expected | Useful safe name · not raw CDN filename · no signed query in name · correct extension/MIME · recognizable completed item |

---

## C. TIKTOK

### 3. Download supported TikTok video

| Field | Value |
| --- | --- |
| Status | NOT_TESTED |
| Expected | Safe useful name · no native/deep-link string in filename · correct extension/MIME · completed card |

---

## D. GENERAL WEBSITE

### 4. Download general website MP4

| Field | Value |
| --- | --- |
| Status | NOT_TESTED |
| Expected | Title/domain fallback sensible · correct MIME · correct size |

---

## E. WEBM

### 5. Download supported WebM

| Field | Value |
| --- | --- |
| Status | NOT_TESTED |
| Expected | `.webm` · `video/webm` · Play capability only if existing player supports it |

---

## F. HLS

### 6. Download known supported unencrypted HLS

| Field | Value |
| --- | --- |
| Status | NOT_TESTED |
| Expected | Completed item describes **actual** final artifact · not `.m3u8` merely because playlist was `.m3u8` · correct actual final size · Phase 1 HLS integrity unchanged |

---

## G. UGLY SOURCE URL

### 7. Download media from URL with `?id=123&token=SECRET`

| Field | Value |
| --- | --- |
| Status | NOT_TESTED |
| Expected | No token/query in filename · useful fallback name |

---

## H. CONTENT-DISPOSITION

### 8. If available, test server filename

| Field | Value |
| --- | --- |
| Status | NOT_TESTED |
| Expected | Safe sanitized title · traversal impossible · extension agrees with finalized media |

---

## I. LONG TITLE

### 9. Download media with very long page/title metadata

| Field | Value |
| --- | --- |
| Status | NOT_TESTED |
| Expected | Bounded filename · Library does not overflow/crash |

---

## J. APP RESTART

### 10–12. Complete download → force stop → reopen

| Field | Value |
| --- | --- |
| Status | NOT_TESTED |
| Expected | Same completed filename · same display title · same completion timestamp · same MIME/container · item remains playable where supported |

---

## K. LEGACY RECORD

### 13. Existing pre-7A completed download

| Field | Value |
| --- | --- |
| Status | NOT_TESTED |
| Expected | No migration crash · safe fallback presentation |

---

## L. ACTIVE VS COMPLETED

### 14. One active + one completed job

| Field | Value |
| --- | --- |
| Status | NOT_TESTED |
| Expected | Active shows progress/state · completed clearly completed · no fake active progress on completed |

---

## M. FAILED / CANCELLED

### 15–16. Failed job · Cancelled job

| Field | Value |
| --- | --- |
| Status | NOT_TESTED |
| Expected | Never presented as completed file |

---

## N. MISSING FILE

### 17. Completed catalog entry with missing physical file (dev-only)

| Field | Value |
| --- | --- |
| Status | NOT_TESTED |
| Expected | No crash · no false Play · sensible unavailable behavior |

---

## O. PRIVACY

### 18. Inspect Logcat during completion

| Field | Value |
| --- | --- |
| Status | NOT_TESTED |
| Expected | Must NOT contain Cookie · Authorization · signed query values · request headers · OTP/password |

### 19. Inspect persisted metadata where practical

| Field | Value |
| --- | --- |
| Status | NOT_TESTED |
| Expected | Must NOT contain newly persisted Phase 7A auth secrets |

---

## P. ACTION SURFACE

### 20. Completed item action menu

| Field | Value |
| --- | --- |
| Status | NOT_TESTED |
| Expected | Professional · correct enabled/disabled capability · no dead misleading production actions · Play may work via existing player · Open/Share/Export must NOT pretend to work if 7B/7C not implemented on that surface |

---

## Q. PHASE 1 REGRESSION

### 21–22. Pause/resume direct MP4 → complete successfully

| Field | Value |
| --- | --- |
| Status | NOT_TESTED |
| Expected | 7A naming does not break resume/finalization |

### 23. Download another file

| Field | Value |
| --- | --- |
| Status | NOT_TESTED |
| Expected | Separate download directory · no filename collision/corruption |

---

## Sign-off

| Field | Value |
| --- | --- |
| Tester | |
| Device / Android version | |
| Build | APK_NOT_BUILT_BY_REQUEST (test when available) |
| Overall | NOT_TESTED |
