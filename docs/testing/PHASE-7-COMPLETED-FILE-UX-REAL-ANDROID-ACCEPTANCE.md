# Phase 7 — Completed File UX — Real Android Acceptance

Final integrated Phase 7 device acceptance (7A identity + 7B actions/notifications + 7C save/delete).

All device cases start as **NOT_TESTED**.

Static/code verification ≠ real Android MediaStore / Gallery / SAF / notification proof.

---

## A. MP4 SAVE

### 1–3. Download valid MP4 → COMPLETED → Save to device

| Field | Value |
| --- | --- |
| Status | NOT_TESTED |
| Expected | Saving… → Saved to device · private file still exists · public copy visible · `.mp4` · `video/mp4` · correct name · playable |

---

## B. WEBM SAVE

### 4–5. Download WebM → Save

| Field | Value |
| --- | --- |
| Status | NOT_TESTED |
| Expected | `.webm` · `video/webm` · public file accessible · no MP4 relabeling · record Gallery compatibility separately from export success |

---

## C. HLS / TS SAVE

### 6. Supported HLS resulting in `.ts` → Save

| Field | Value |
| --- | --- |
| Status | NOT_TESTED |
| Expected | Actual `.ts` · actual MIME · no `.mp4` fake conversion · public file in documented safe collection |

---

## D. DUPLICATE SAVE

### 7–8. Save same completed item → Save again

| Field | Value |
| --- | --- |
| Status | NOT_TESTED |
| Expected | Documented duplicate policy · **Already saved** when receipt + public URI present · no unnecessary duplicate · never overwrite unrelated public file |

---

## E. PUBLIC COPY DELETED EXTERNALLY

### 9–12. Save → delete public copy in Files/Gallery → return → Save again

| Field | Value |
| --- | --- |
| Status | NOT_TESTED |
| Expected | Stale export receipt reconciled · new export succeeds · private file unaffected |

---

## F. EXPORT FAILURE

### 13. Safely reproducible export failure

| Field | Value |
| --- | --- |
| Status | NOT_TESTED |
| Expected | Original completed VidoraX file remains · stays COMPLETED · no ghost success · no broken pending public item if cleanable |

---

## G. LARGE FILE

### 14. Save large 500MB+ completed file (if practical)

| Field | Value |
| --- | --- |
| Status | NOT_TESTED |
| Expected | UI responsive · no JS memory / Base64 explosion · streamed · exact public copy |

---

## H. RESTART AFTER EXPORT

### 15–17. Export successfully → force-stop → reopen

| Field | Value |
| --- | --- |
| Status | NOT_TESTED |
| Expected | Private item stable · duplicate policy remembered/reconciled · app does not re-export automatically |

---

## I. INTERRUPTED EXPORT

### 18–20. Start large export → force-stop mid-op → reopen

| Field | Value |
| --- | --- |
| Status | NOT_TESTED |
| Expected | No permanent Saving… · private completed file usable · pending reconciles safely · no destructive cleanup of published files |

---

## J. DELETE PRIVATE

### 21–22. Complete download → Delete from VidoraX

| Field | Value |
| --- | --- |
| Status | NOT_TESTED |
| Expected | Confirm: “Delete this download from VidoraX? Copies saved outside VidoraX will not be deleted.” · canonical private file removed · catalog removed · no crash |

---

## K. EXPORTED COPY SURVIVES PRIVATE DELETE

### 23–27. Complete → Save → verify public → Delete from VidoraX → open Files/Gallery

| Field | Value |
| --- | --- |
| Status | NOT_TESTED |
| Expected | **Mandatory:** public exported copy still exists · still plays · VidoraX private item gone |

---

## L. DELETE FAILURE

### 28. Safely reproducible file delete failure

| Field | Value |
| --- | --- |
| Status | NOT_TESTED |
| Expected | Library item remains · no false Deleted toast · retry possible |

---

## M. MISSING PRIVATE FILE

### 29. Catalog COMPLETED but physical file missing

| Field | Value |
| --- | --- |
| Status | NOT_TESTED |
| Expected | No Play · no Open · no Share · no Save · no crash · Remove/Delete cleans stale Library entry |

---

## N. ACTIVE / PAUSED SAFETY

### 30–31. Start download → Pause → 7C cleanup/restart path → Resume

| Field | Value |
| --- | --- |
| Status | NOT_TESTED |
| Expected | `.part` remains · PAUSED file not deleted · download still completes after resume |

---

## O. MULTIPLE DOWNLOADS

### 32–34. Complete A · Complete B · Save both

| Field | Value |
| --- | --- |
| Status | NOT_TESTED |
| Expected | Correct public files · correct names · no cross-download operation state |

---

## P. SAVE + DELETE RACE

### 35–36. Start Save on large item → attempt Delete immediately

| Field | Value |
| --- | --- |
| Status | NOT_TESTED |
| Expected | Deterministic: Delete blocked/waits · canonical file must not disappear mid-export |

---

## Q. OPEN / SHARE AFTER SAVE

### 37. Save file → Play / Open / Share from VidoraX

| Field | Value |
| --- | --- |
| Status | NOT_TESTED |
| Expected | Phase 7B behavior remains valid · private file remains canonical |

---

## R. NOTIFICATION AFTER DELETE

### 38. Completion notification → delete private item

| Field | Value |
| --- | --- |
| Status | NOT_TESTED |
| Expected | Stale VidoraX notification dismissed or safe fallback on tap · no crash |

---

## S. LEGACY ANDROID

### 39. API 24–28 Save (when emulator/device available)

| Field | Value |
| --- | --- |
| Status | NOT_TESTED |
| Expected | Safe system picker/fallback · no unnecessary broad storage permission · user cancellation safe · do not automate now |

---

## T. PRIVACY

### 40. Inspect Logcat during Save / duplicate Save / delete / failed export / reconciliation

| Field | Value |
| --- | --- |
| Status | NOT_TESTED |
| Expected | Must **not** reveal Cookie · Authorization · requestContext · signed source URL/query · OTP · password · browser auth headers |

---

## U. PUBLIC METADATA

### 41. Inspect exported item via Android Files / media details

| Field | Value |
| --- | --- |
| Status | NOT_TESTED |
| Expected | Safe filename · correct extension · correct MIME where Android exposes it · no signed token/title leak |

---

## V. FINAL END-TO-END PHASE 7

### 42–51. Full journey

| # | Step | Status | Expected |
| --- | --- | --- | --- |
| 42 | Website → Download | NOT_TESTED | Starts transfer |
| 43 | Phase 1 → COMPLETED | NOT_TESTED | Validated private file |
| 44 | Library card | NOT_TESTED | Useful title/filename/format/size |
| 45 | Play | NOT_TESTED | Works |
| 46 | Open | NOT_TESTED | Works |
| 47 | Share | NOT_TESTED | Works |
| 48 | Completion notification | NOT_TESTED | Works |
| 49 | Save to device | NOT_TESTED | Works |
| 50 | Delete from VidoraX | NOT_TESTED | Works |
| 51 | Exported public copy | NOT_TESTED | Remains available |

This is the final Phase 7 acceptance journey.
