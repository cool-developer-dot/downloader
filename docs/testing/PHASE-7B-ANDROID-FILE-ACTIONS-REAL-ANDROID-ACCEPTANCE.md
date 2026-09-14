# Phase 7B — Android File Actions — Real Android Acceptance

All device cases start as **NOT_TESTED**.

Static verification ≠ real Android chooser / Sharesheet / notification proof.

---

## A. PLAY — MP4

### 1–3. Download valid MP4 → Library → Play

| Field | Value |
| --- | --- |
| Status | NOT_TESTED |
| Expected | VidoraX player · local completed file · no network · correct title/MIME · no crash |

---

## B. PLAY — WEBM

### 4. Supported WebM

| Field | Value |
| --- | --- |
| Status | NOT_TESTED |
| Expected | Play if codec supports OR honest unsupported behavior · no fake MP4 conversion |

---

## C. PLAY — HLS FINAL FILE

### 5. Supported HLS

| Field | Value |
| --- | --- |
| Status | NOT_TESTED |
| Expected | Record actual `.ts`/`.mp4` player behavior · do not change extension for Play |

---

## D. OPEN WITH

### 6–7. Completed MP4 → Open with… → external player

| Field | Value |
| --- | --- |
| Status | NOT_TESTED |
| Expected | Android chooser · content:// · video opens · no private path |

---

## E. NO COMPATIBLE APP

### 8. If reproducible

| Field | Value |
| --- | --- |
| Status | NOT_TESTED |
| Expected | Friendly error · no crash |

---

## F. SHARE

### 9. Completed MP4 → Share

| Field | Value |
| --- | --- |
| Status | NOT_TESTED |
| Expected | Sharesheet · video recognized · recipient playable |

---

## G. LARGE FILE SHARE

### 10. Large completed video

| Field | Value |
| --- | --- |
| Status | NOT_TESTED |
| Expected | No huge JS memory / base64 · Sharesheet opens |

---

## H. FILE MISSING

### 11. Missing physical file

| Field | Value |
| --- | --- |
| Status | NOT_TESTED |
| Expected | Play/Open/Share unavailable · no crash |

---

## I. COMPLETION NOTIFICATION

### 12–13. Grant notifications · complete download

| Field | Value |
| --- | --- |
| Status | NOT_TESTED |
| Expected | Download completed · safe title · no source URL/token |

---

## J. COMPLETION TAP

### 14. Tap completion notification

| Field | Value |
| --- | --- |
| Status | NOT_TESTED |
| Expected | Correct download details destination |

---

## K. COLD-START NOTIFICATION TAP

### 15–16. Force-stop · tap notification

| Field | Value |
| --- | --- |
| Status | NOT_TESTED |
| Expected | App starts · router ready · safe destination · no crash |

---

## L. FAILURE NOTIFICATION

### 17. Known failure

| Field | Value |
| --- | --- |
| Status | NOT_TESTED |
| Expected | Download failed · safe reason · no stack/URL |

---

## M. RETRY

### 18. Transient retry then COMPLETED

| Field | Value |
| --- | --- |
| Status | NOT_TESTED |
| Expected | No final failure during RETRYING · one completion notification |

---

## N. DUPLICATE PROTECTION

### 19–22. Complete · open Library · restart

| Field | Value |
| --- | --- |
| Status | NOT_TESTED |
| Expected | One completion notification · not reposted |

---

## O. MULTIPLE DOWNLOADS

### 23. Complete A and B

| Field | Value |
| --- | --- |
| Status | NOT_TESTED |
| Expected | Distinct A/B notifications |

---

## P. NOTIFICATION DENIED

### 24. Deny notifications · download

| Field | Value |
| --- | --- |
| Status | NOT_TESTED |
| Expected | Download/Library/Play/Open/Share still work · no permission loop |

---

## Q. SESSION-BOUND FAILURE

### 25. Session expired if practical

| Field | Value |
| --- | --- |
| Status | NOT_TESTED |
| Expected | Safe Session expired message · no Cookie/Auth in notification |

---

## R. PRIVACY — LOGCAT

### 26. During Play/Open/Share/notifications

| Field | Value |
| --- | --- |
| Status | NOT_TESTED |
| Expected | No Cookie · Authorization · requestContext · signed query · OTP |

---

## S. CONTENT URI

### 27. External action uses content://

| Field | Value |
| --- | --- |
| Status | NOT_TESTED |
| Expected | content://… · not file:///data/user/… |

---

## T. APP STATE

### 28. After Play/Open/Share (success or failure)

| Field | Value |
| --- | --- |
| Status | NOT_TESTED |
| Expected | Record remains COMPLETED |

---

## U. PHASE 7A REGRESSION

### 29–30. Identity after Open/Share · restart

| Field | Value |
| --- | --- |
| Status | NOT_TESTED |
| Expected | Filename/title/size/MIME unchanged |

---

## V. PHASE 1 REGRESSION

### 31–33. Pause/resume MP4 · complete · Share

| Field | Value |
| --- | --- |
| Status | NOT_TESTED |
| Expected | Integrity unaffected |

---

## Sign-off

| Field | Value |
| --- | --- |
| Tester | |
| Device / Android | |
| Build | APK_NOT_BUILT_BY_REQUEST |
| Overall | NOT_TESTED |
