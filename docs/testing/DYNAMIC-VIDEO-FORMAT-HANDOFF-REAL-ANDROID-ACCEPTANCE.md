# Dynamic video format handoff — real Android acceptance

Status: **NOT_TESTED**. Static/Node verifiers do not certify Android runtime.

APK_NOT_BUILT_BY_REQUEST

EXPO_PREBUILD_NOT_RUN

## Device record

Record device/model, Android version, RAM, Android System WebView version, installed
app revision, file codec/container, network mode and test time. Use an explicitly
authorized installed native build containing these Kotlin changes. No APK/AAB or
prebuild was produced during this task.

Use controlled, legally accessible non-YouTube fixtures and authorized browser
sessions. Record sanitized IDs, stages, status transitions, selected resolution and
container, byte counts, final filename/MIME and whether Open/Share refer to the same
file. Redact signed URLs, tokens, cookies, headers and private absolute paths.

## Standard successful flow

1. Open the fixture in Browser and start/activate the visible video.
2. Confirm internal candidate observation/correlation/verification precedes the bar.
3. Tap `Video available`. One source downloads directly; multiple sources open the
   existing quality sheet. Choose a specific verified variant.
4. Confirm one job appears immediately in Downloads with the selected identity.
5. Wait through the existing transfer and `FINALIZING` states; require a verified
   physical final file before `COMPLETED`.
6. Confirm Library retains the item. Disable networking and attempt Play.
7. If decoding is unsupported, use `Open with…`; check Open/Share/export against
   the same authoritative completed file. No `library.file_missing` for valid files.

## Required matrix

| # | Scenario | Expected evidence/result | Runtime result |
| --- | --- | --- | --- |
| 1 | Direct MP4 on dynamic page | Full standard flow and offline Play with supported codec | NOT_TESTED |
| 2 | Extensionless MP4 / octet-stream | Bytes prove MP4; same handoff, final MIME and Library identity | NOT_TESTED |
| 3 | WebM | Detect/download/finalize/Library; codec-dependent Play or external Open | NOT_TESTED |
| 4 | M4V | M4V filename/MIME preserved across download and Library | NOT_TESTED |
| 5 | MOV, including QuickTime brand | MOV identity preserved; decoder capability reported honestly | NOT_TESTED |
| 6 | AVI | Download/finalize/Library retained; external Open on decoder failure | NOT_TESTED |
| 7 | WMV | Same as AVI; reject audio-only ASF as video evidence | NOT_TESTED |
| 8 | Standalone fMP4 plus init/fragment controls | Complete initialized file accepted; isolated resources never offered | NOT_TESTED |
| 9 | HLS master with 1080/720/480 children | Each child clear/VOD verified; selected rendition reaches existing HLS worker | NOT_TESTED |
| 10 | Single verified quality | Direct download from user tap; no quality picker | NOT_TESTED |
| 11 | Cross-origin/nested iframe | Physical tab and observable frame/referrer evidence link candidate to visible owner | NOT_TESTED |
| 12 | SPA video A→B, then tracking/hash churn | A removed, B current; same-content churn retains B | NOT_TESTED |
| 13 | Lazy/dynamic video/source insertion/replacement | New currentSrc/source metadata detected without full reload | NOT_TESTED |
| 14 | Service-worker traffic | Unique document evidence reaches canonical native ingress; ambiguous events stay unowned | NOT_TESTED |
| 15 | DOM + fetch/XHR + native duplicate | One offer/variant/job; no event storm | NOT_TESTED |
| 16 | Multiple MP4/WebM query-selected variants | Clean resolution/container rows; exact selected URL/context reaches enqueue | NOT_TESTED |
| 17 | Encrypted AES-128/SAMPLE-AES HLS | No actionable offer or segment/key downloading | NOT_TESTED |
| 18 | DRM / EME / protected MP4 | Unsupported; no false available CTA | NOT_TESTED |
| 19 | DASH with separate tracks/SegmentTemplate | No mux/download path; no actionable offer | NOT_TESTED |
| 20 | YouTube browsing | No YouTube-specific extraction/deciphering/downloader targeting | NOT_TESTED |
| 21 | URL expires while bar/sheet open | Same-resource legitimate refresh or concise failure; never substitute another quality | NOT_TESTED |
| 22 | Video-looking URL returns HTML/login/JSON | Never completed; existing failure/retry behavior | NOT_TESTED |
| 23 | Progressive pause/resume | Valid 206/range resumes; 200 or changed validators never blindly append | NOT_TESTED |
| 24 | Library physical identity | Play/Open/Share/export use persisted final path after rename, restart and offline mode | NOT_TESTED |
| 25 | 4 GB Android, multi-tab plus active download | Responsive taps/scroll, bounded events/caches, no runaway listeners or timers | NOT_TESTED |

## Additional race and failure checks

| Scenario | Expected result | Runtime result |
| --- | --- | --- |
| Two mounted tabs with identical URLs | Parked-tab and ambiguous service-worker media cannot own active CTA | NOT_TESTED |
| Fast navigation/reload and renderer recreation | Native wrapper tags rebind; pre-binding/stale epochs cannot publish | NOT_TESTED |
| Native request before JS observer and late metadata | Eligible candidates can be reconsidered; uncertain ownership remains internal | NOT_TESTED |
| Reused/aborted XHR and long SPA browsing | Listener and timer counts stay bounded after repeated navigation | NOT_TESTED |
| Repeated HLS offer from cache | All previously verified alternatives remain visible | NOT_TESTED |
| Double-tap quality confirmation; navigate while gate pending | At most one job; stale freeze rejected | NOT_TESTED |
| Headless/opaque frame, referrer suppression, blob without observable source | No speculative available offer; truthful unresolved result | NOT_TESTED |
| Wi-Fi Only, offline/online changes | Existing waiting/admission rules unchanged | NOT_TESTED |
| HLS checkpoint recovery/interruption | Existing checkpoint semantics retained; no fabricated user-pause support | NOT_TESTED |
| Low storage, zero bytes, missing/short final file | Never marked completed; recoverable failure visible | NOT_TESTED |
| Rename collision or late native move error | Persist existing verified physical path or fail; never missing target | NOT_TESTED |
| Large moov/prefix outside byte-probe budget | Remains unresolved; no size-only proof | NOT_TESTED |
| Share/Open chooser cancellation or no compatible app | Clear localized result; completed file retained | NOT_TESTED |
| Notification tap and App Lock during active/completed download | Existing destination, privacy and unlock flow retained | NOT_TESTED |

## Recording results

Replace `NOT_TESTED` only after execution on the recorded device. Use `PASS`, `FAIL`
or `BLOCKED` with sanitized evidence and a reason. Record native crash/logcat issues,
codec failures, UI freezes and file identity separately. A static pass is never a
substitute for these runtime results.
