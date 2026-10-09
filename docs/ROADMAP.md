# VidoraX roadmap — Phases 16–22

Source: the owner's feature checklist (`1234 VidoraX.xlsx`, 985 features in 4 modules), verified against the code on
2026-10-03. The verified workbook is `docs/feature-audit/VidoraX-feature-checklist-verified-2026-10-03.xlsx`: column F
is the verified status, J the original APK-scan status, K the verdict, L the file-level evidence and M the phase of each
row. HANDOFF §4.31 summarizes the audit. Keep this file and the workbook in step: when a phase lands, flip its rows to
✔ in column F, set M to `Done`, and add the HANDOFF §4 entry.

| Module | Features | ✔ verified (APK scan said) | Phases 16–22 | Not planned |
|---|---:|---:|---:|---:|
| Browser | 289 | 69 (65) | 126 | 94 |
| Downloader | 229 | 86 (85) | 87 | 56 |
| Player | 222 | 51 (54) | 98 | 73 |
| File Manager | 245 | 37 (18) | 56 | 152 |
| **Total** | **985** | **243 (222)** | **367** | **375** |

## Rules for every phase

- **Local only.** No accounts, sync, cloud or server calls (memory `vidorax-local-only`); backups are files the user
  picks a place for.
- **Unchanged refusals:** YouTube, DRM, encrypted HLS, login/paywall bypass. Live recording stays a non-goal until the
  owner decides (Phase 22).
- **Play policy first.** Any new permission or foreground-service type needs its Play Console declaration and a
  `docs/play-console/PLAY_SUBMISSION.md` update in the same phase; avoid restricted permissions
  (`MANAGE_EXTERNAL_STORAGE`, `REQUEST_INSTALL_PACKAGES`, `SYSTEM_ALERT_WINDOW`, `QUERY_ALL_PACKAGES`,
  `REQUEST_IGNORE_BATTERY_OPTIMIZATIONS`).
- **Every new string in English and Urdu**; RTL checked.
- **Done means:** unit tests for the logic, `npm test` / `tsc` / ESLint clean, native tests with `--rerun`, then a
  release-build check on the Pixel_8 AVD (memory `android-detection-device-testing`), and the workbook row flipped.
- Do not run `npx expo prebuild`; build Gradle through `scripts/dev/gradle.sh`.

## Phase 16 — Make every ✔ true (27 rows)

Everything the checklist ticks must actually work. These rows were ticked by the APK scan, or are the same feature
seen from another module, but the code does not have them (or lost them on 2026-10-01). Ordered small → large.

| # | Rows | Task | Where | Done when |
|---|---|---|---|---|
| 1 | Update Check #476 | Set `PLAY_STORE_LISTING_URL` to `https://play.google.com/store/apps/details?id=com.vidorax.fast.videodownloader` once the listing is live (also enables Rate VidoraX). | `src/constants/app-identity.ts` | About → Check for Updates and Rate open the Play listing. |
| 2 | Open Link in New Tab #50 | Enable `openInNewTabAction`; implement `context.openInNewTab` with `browserStore.createTab(url)` + the 10-tab limit toast; localize the link sheet ("Link options" and the action labels are hard-coded English). | `src/browser/actions/builtins/open-in-new-tab.action.ts`, `useBrowserLongPressActions.ts` | Long-press a link → Open in New Tab opens and focuses a new tab; Urdu labels. |
| 3 | Clear Search History #60 | "Clear recent searches" row in History (and in the omnibox suggestion list) calling the existing store `clear()`. | `src/store/recent-searches`, History screen | Recent searches disappear from suggestions. |
| 4 | Open Clipboard Link #27 | Home "Paste link": read the clipboard; if it holds an http(s) link, open it through `pasted-link.service` in the browser; otherwise open the browser with the address bar focused. | `HomeScreen`, `useQualitySelection.open` | Copy a reel link → Home → Paste link → the reel loads and is analyzed. |
| 5 | Copy Link #404, Re-download #403 | Download details + library actions: Copy link (page URL, else source URL); Re-download for failed/missing items = open the source page in a tab (detection does the rest). | `src/screens/downloads`, `src/screens/library` | Both actions visible for completed, failed and missing items. |
| 6 | Remaining Time #529, Double Tap Center #584 | Tap the duration to toggle total ↔ −remaining (remembered); double-tap the middle third of the centre zone toggles play/pause while the outer halves keep ±10 s seek. | `PlayerTimeline.tsx`, `double-tap-seek.ts`, `PlayerVideoSurface.tsx` | Unit tests for zones; works with zoomed video. |
| 7 | Translate Page #262 | Browser menu → Translate page opens `https://translate.google.com/translate?u=<page>` in a new tab (user-initiated only; mention in the Privacy Policy). | `browser-menu-actions.ts` | Translated page opens; detection still runs in that tab. |
| 8 | Save cover image #371 | "Save thumbnail" in library item actions → MediaStore `Pictures/VidoraX`. | native `library/GalleryExport.kt`, library actions | Image appears in Gallery. |
| 9 | Web video fullscreen #167 #219, rotation #168 | Set `allowsFullscreenVideo`; on enter-fullscreen unlock orientation and hide system bars, restore on exit (reuse `player/orientation-controller.ts`). | `webview-configuration.ts`, `BrowserWebView.tsx` | Fullscreen button on a page video works and rotates to landscape. |
| 10 | Junk Cleaner #852 | Storage → "Leftover download files": list `.part`/HLS workspaces not owned by any download row, with size, and delete them. | native `StoragePaths`/engine, `src/storage-manager` | Orphans from a killed download are found and removed; active ones never listed. |
| 11 | Seek Thumbnail Preview #530 | While scrubbing, `player.generateThumbnailsAsync(t)` (throttled, local files only) shown above the thumb. | `PlayerTimeline.tsx`, `SeekFeedback.tsx` | Preview frames follow the finger without stutter on a 1080p file. |
| 12 | Open video files from other apps #673 #693 #873 #947 | Add `VIEW` intent-filters for `video/*` and `audio/*` (content:// and file://); play them in an "external source" session (no library row) with an optional "Save to VidoraX". | `AndroidManifest.xml`, `+native-intent.ts`, `resolve-playback-source.ts` | Files app → Open with → VidoraX plays the file; nothing is copied unless the user saves it. |
| 13 | Streaming Protocols #664 | Let the player open http(s) progressive/HLS/DASH sources (expo-video supports them) — used by "Play" on a browser offer before downloading; same refusals as downloads (DRM, YouTube). | `resolve-playback-source.ts`, player session | An offered HLS stream plays in the VidoraX player. |
| 14 | Background Audio #214, Media Notification #215, Lock Screen Controls #658, Notification Player #659, Background Play #695 | Settings → "Keep playing in background" (default off). Re-add `ExpoVideoPlaybackService` + `FOREGROUND_SERVICE_MEDIA_PLAYBACK`, app.json `supportsBackgroundPlayback: true`, and set `staysActiveInBackground` + `showNowPlayingNotification` when on. Play Console: mediaPlayback FGS declaration + demo video. | manifest, app.json, `use-player-session.ts`, settings, `PLAY_SUBMISSION.md` | Screen off → audio continues with notification + lock-screen controls; off by default. |
| 15 | Multi-threaded Download #336, Dynamic Segmentation #338 | Native `ProgressiveTransfer`: when the server proves ranges and the size is known (≥ 16 MB), fetch 2–4 ranges in parallel into per-part files with their own validators/checkpoints, then join; fall back to one connection on any 200/416/mismatch. Never for signed links that reject ranges. | `transfer/ProgressiveTransfer.kt`, `transfer/PartFiles.kt`, `engine/DownloadEngine.kt` | JVM tests for split/resume/fallback; a 500 MB public MP4 is faster and byte-identical. |

Also in Phase 16 (in-app text found wrong during the audit): FAQ "How do I change the theme?" names Light/Dark/System
(the options are System/Red/Dark); FAQ "Can I pause and resume downloads?" says HLS can't be paused (it can); keep
`support/faq-content.ts` answers in step with the code.

## Phases 17–22

Order: 17 and 19 first (most-used surfaces), then 20, 21, 18, 22. Within a phase, ship the items users touch daily
first (e.g. 17: close all/other tabs, reopen closed tab, find in page, bookmark edit/folders; 19: pause/resume/cancel
all — the native `pauseAll`/`resumeAll` already exist — queue priority, speed limit; 20: subtitles, audio tracks,
fit/fill, long-press 2×, sleep timer; 21: multi-select, filter by site, recycle bin, biometric unlock).

Implementation notes for the bigger items:

- **Find in page (17):** `WebView.findAllAsync`/`findNext` via a small `vidorax-web` native method; match count from
  `FindListener`.
- **Incognito (18):** a separate WebView profile (`androidx.webkit` multi-profile) or no-persist mode: no history,
  cookies wiped on close, downloads still allowed with a notice; `FLAG_SECURE` while an incognito tab is visible.
- **Ad/tracker/pop-up blocking (18):** local filter lists bundled with the app (no remote updates — local-only rule),
  applied in the native `shouldInterceptRequest` hook that already exists; never block media requests detection
  needs.
- **Save as PDF / Print / Save offline (18):** `WebView.createPrintDocumentAdapter` + `PrintManager`;
  `WebView.saveWebArchive` (MHTML) into app storage.
- **Scheduling, battery and roaming rules (19):** constraints on the existing user-initiated job / `dataSync` runner;
  no `REQUEST_IGNORE_BATTERY_OPTIMIZATIONS`.
- **Subtitles (19 download, 20 player):** HLS/DASH subtitle renditions downloaded beside the video; external
  SRT/VTT sideloaded through Media3 `SubtitleConfiguration` (a small native addition if expo-video does not expose
  it).
- **Audio effects (20):** equalizer / bass boost / virtualizer / loudness need the player's audio session id —
  a native bridge to expo-video's ExoPlayer instance.
- **Trim / extract audio / convert / compress (19, 20):** reuse `process/Transcoder` (Media3 Transformer).
- **Private vault (21):** a library flag that hides items from lists and Gallery export, behind App Lock;
  biometric unlock via `expo-local-authentication` (BiometricPrompt).
- **Backup / restore (21):** export library metadata + settings (and optionally media) to a user-picked folder (SAF);
  restore is idempotent and per-device.

### Phase 17 — Browser core (56)

Tabs, address bar, navigation, find in page, bookmarks and history tools.

- **Browser:** Reopen Closed Tab (#3), Pin Tab (#5), Tab Groups (#6), Duplicate Tab (#7), Mute Tab (#8), Close Other Tabs (#9), Close All Tabs (#10), Drag to Reorder (#11), Search Tabs (#13), Tab Preview (#14), Auto Sort Tabs (#17), URL Autocomplete (#24), Address Bar Position (#28), Auto Hide Address Bar (#29), Search Shortcuts (#33), Paste and Go (#35), Search Engine Icon (#36), Domain Highlight (#37), Hard Reload (#42), Long Press Back History (#44), Swipe Navigation (#45), Scroll to Top (#46), Scroll to Bottom (#47), Open in Background (#51), Choose Search Engine (#56), Site Search (#57), Disable Suggestions (#61), Safe Search (#62), Search Language (#63), Region Setting (#64), Find in Page (#66), Match Count (#67), Next/Previous Match (#68), Match Case (#69), Whole Word (#70), Highlight Matches (#71), Bookmark Folders (#77), Edit Bookmark (#78), Reorder Bookmarks (#80), Bookmark All Tabs (#83), Import Bookmarks (#84), Export Bookmarks (#85), Add to Home Screen (#87), Reading List (#89), Broken Link Check (#91), Tags (#92), Bookmark Notes (#93), Clear by Time Range (#98), Auto Clear on Exit (#99), Disable History (#101), Export History (#103), Set Homepage (#232), Startup Options (#233), Customize Toolbar (#238), Reset Settings (#241), Audio Indicator (#283).

### Phase 18 — Browser privacy, site controls & reading (43)

Incognito, cookies/trackers/ads/pop-ups, site permissions, dark pages, reader mode, save/print page.

- **Browser:** Open in Incognito (#52), Incognito Tab (#104), Incognito Lock (#105), Block Screenshots (#106), Incognito Download Notice (#107), Incognito Theme (#108), Wipe on Close (#109), Incognito Search Engine (#111), Cookie Control (#112), Block Third-Party Cookies (#113), Tracker Blocker (#114), Do Not Track (#115), Site Permissions (#116), Location Permission (#117), Camera and Mic Permission (#118), Notification Permission (#119), Pop-up Blocker (#120), Ad Blocker (#121), Certificate Info (#125), View Site Data (#130), Disable JavaScript (#135), Reader Mode (#161), Force Dark Web Pages (#163), Font Size (#164), Text Reflow (#169), Font Style (#170), Reader Theme (#172), Read Aloud (#173), Screenshot (#174), Full Page Capture (#175), Save as PDF (#176), Print (#177), Save Page Offline (#178), Block Images (#183), Data Saver (#184), Data Usage Counter (#185), Battery Saver (#191), Cache Limit (#192), Images on Wi-Fi Only (#193), Autoplay Control (#218), Change User Agent (#226), Volume Key Scroll (#240), Custom Background (#245).

### Phase 19 — Downloader power features (76)

Bulk controls, queue priority, scheduling, limits, multi-connection, subtitles, trim/convert, stats.

- **Browser:** Ask Where to Save (#155), Open After Download (#156), Dangerous File Warning (#157).
- **Downloader:** Clipboard Monitor (#291), Batch Add (#292), Import Links from File (#293), Rename Before Download (#296), Choose Save Location (#297), Authentication Support (#299), Priority (#305), Remaining Size (#308), Average Speed (#312), Elapsed Time (#314), Segment Progress (#315), Speed Graph (#316), Total Speed Overview (#322), Pause All (#327), Resume All (#328), Cancel All (#329), Retry Limit (#332), Move Priority (#334), Tap to Toggle (#335), Connections per File (#337), Speed Limiter (#339), Per-download Limit (#340), Multiple Queues (#343), Bandwidth Priority (#346), Timeout Setting (#349), Scheduled Download (#351), Start/Stop Time (#352), Disable on Roaming (#354), Pause on Low Battery (#355), Only While Charging (#356), Weekly Schedule (#360), Post-download Action (#361), Subtitle Download (#370), Trim Download (#374), Metadata Tagging (#375), Convert After Download (#376), Filename Template (#379), Preview Before Download (#381), Auto Categorize (#382), Per-type Folder (#383), Per-site Folder (#384), Duplicate Action (#386), Tags (#387), SD Card Download (#395), Size Filter (#396), Show in Folder (#398), Checksum Verify (#409), Play While Downloading (#411), Repair Partial File (#412), Clear History (#415), Daily Data Usage (#416), Monthly Data Usage (#417), Total Count (#418), Error Log (#421), Data Limit Alert (#422), Export History (#423), Custom User Agent (#443), Custom Headers (#444), Notification Sound (#452), Vibrate (#453), Silent Mode (#457), Backup Queue (#462), Default Folder (#465), Default Tab (#474), Confirm Before Start (#479), Per-item Settings (#480), Page Link Grabber (#484), Custom Extension (#494), Download Notes (#495), Export Queue (#502), Import Queue (#503), Quick Add Shortcut (#515), Debug Logs (#518).

### Phase 20 — Player (82)

Subtitles, audio tracks, aspect/fit, repeat/A-B, sleep timer, playlists, audio effects, edit tools.

- **Player:** Stop (#520), Custom Seek Interval (#527), Frame by Frame (#531), Jump to Time (#532), Auto Play Next (#534), Fine Speed Control (#537), Pitch Correction (#538), Repeat One (#539), Repeat All (#540), A-B Repeat (#541), Shuffle (#542), Speed Shortcut (#544), Long Press to Fast Forward (#545), Volume Boost (#548), Equalizer (#549), EQ Presets (#550), Bass Boost (#551), Virtualizer (#552), Audio Track Switch (#553), Audio Delay (#554), Mono/Stereo (#555), Balance (#556), Night Mode Audio (#557), Volume Normalization (#558), Headphone Detection (#560), Hardware Key Control (#562), Aspect Ratio (#564), Crop to Fill (#565), Stretch (#566), Mirror/Flip (#573), Audio Only Mode (#574), Notch/Cutout Support (#576), Horizontal Swipe Seek (#582), Two Finger Tap (#585), Gesture Sensitivity (#586), Disable Gestures (#587), Load Subtitle (#589), Auto Detect Subtitle (#590), Subtitle Size (#592), Subtitle Color (#593), Subtitle Font (#594), Subtitle Background/Outline (#595), Subtitle Position (#596), Subtitle Sync (#597), Multiple Tracks (#598), Dual Subtitles (#599), RTL Subtitles (#600), Subtitle Encoding (#601), Subtitle Off (#602), Subtitle Formats (#603), Create Playlist (#617), Edit Playlist (#618), Play Queue (#619), Play Next (#620), Most Played (#626), Include/Exclude Folders (#628), Playlist Import/Export (#629), Sleep Timer (#644), Headset Button Control (#661), Network Stream (#663), Adaptive Bitrate (#670), Download Integration (#672), Screenshot (#675), Trim Video (#677), Extract Audio (#678), Video Converter (#679), Compress Video (#680), Disable History (#687), Customize Controls (#692), External Remote (#701), Show on Lock Screen (#703), Video Bookmarks (#705), Play Count (#708), Duration Filter (#711), Kid Lock (#712), Info Overlay (#721), Save Loop (#722), Quick Delete (#726), Save EQ (#729), Playback Time Limit (#730), Next Episode Prompt (#733), Per-book Speed (#736).

### Phase 21 — Library, privacy & backup (63)

Multi-select, filters, recycle bin, private vault, biometric unlock, local backup/restore.

- **Browser:** Backup and Restore (#209).
- **Downloader:** Lock File (#413), Private Folder (#459), Hide History (#460), File Encryption (#463), Reset Settings (#470), Settings Backup (#471).
- **Player:** Private Folder (#686), Block Screen Capture (#689), Backup/Restore (#700).
- **File Manager:** Back (#742), Up One Level (#743), Favorites (#750), Categories (#753), Thumbnail Size (#763), Folders First (#767), Show Extensions (#770), Folder Size (#771), Item Count (#772), Accent Colors (#775), Folder Icon Color (#778), File Type Icons (#779), Multi-select (#788), Select All (#789), Invert Selection (#790), Drag Select (#791), Batch Rename (#793), Auto Numbering (#794), Conflict Resolution (#797), Recycle Bin (#801), Undo (#804), Filter by Type (#809), Filter by Size (#810), Filter by Date (#811), Search by Extension (#812), Find Duplicates (#819), Old Files (#823), Recently Modified (#824), Sort Results (#825), Checksum (#827), Full Path (#834), MIME Type (#835), One-tap Clean (#853), Low Space Alert (#855), Clean Downloads (#856), Media Preview (#866), Secure Vault (#908), File Encryption (#909), Folder Lock (#910), Hide File (#911), Biometric Unlock (#912), Block Screenshots (#916), Backup (#930), Restore (#932), Settings Backup (#936), Auto Organize (#937), Tags/Labels (#939), File Notes (#941), Default Folder (#946), Reset (#950), Drag Reorder (#954), Rescan Media (#973), Color Tags (#977).

### Phase 22 — Extras (20)

QR, voice search, widgets, Cast, site blocker, live recording and other optional add-ons.

- **Browser:** QR Code Scan (#30), Voice Search (#31), Search Widget (#65), Translate Selection (#75), Cast (#216), Create QR Code (#249), Camera Upload (#255), PDF Viewer (#264), PDF Open Choice (#265), Default Urdu Font (#272), Open in App Prompt (#273), Site Blocker (#276), Site Time Limit (#277), Focus Mode (#278).
- **Downloader:** Live Stream Recording (#377), Home Widget (#456).
- **Player:** Chromecast (#667), Create GIF (#676), Merge Videos (#682), Change Speed Export (#684).

## Not planned (375)

- **torrent/P2P: Google Play policy risk and outside a page-video downloader** (15): Add Torrent (#302), Magnet Link (#303), Peers List (#426), Seeds/Leechers (#427), Upload Limit (#428), Share Ratio (#429), Select Files in Torrent (#430), Trackers (#431), DHT Support (#432), Sequential Download (#433), IP Filter (#434), Port Setting (#435), Disable Upload (#436), Bind to VPN (#437), Protocol Encryption (#440).
- **needs accounts, cloud or a server; VidoraX keeps all data on the device by design** (39): Tabs from Other Devices (#20), Sync Bookmarks (#86), History Sync (#102), Sign In (#202), Sync (#203), Selective Sync (#204), Sync Encryption (#205), Multiple Profiles (#206), Switch Profile (#207), Guest Mode (#208), Export Data (#210), Sign Out (#211), Send to Device (#251), Collaborative Browsing (#257), Remote Control (#438), Web UI (#439), Download Folder from Cloud (#507), Cross-device Sync (#510), Send to Device (#511), Save to Cloud (#512), Auto Upload (#513), Cloud Playback (#671), Share Playlist (#728), Google Drive (#895), Dropbox/OneDrive (#896), FTP/SFTP (#897), SMB/LAN (#898), WebDAV (#899), Cloud Backup (#900), Auto Sync (#901), Offline Access (#902), Multiple Accounts (#903), Cloud to Cloud Transfer (#904), Upload Progress (#905), Cloud Quota (#906), Scheduled Backup (#931), Incremental Backup (#933), Backup to SD (#934), Folder Sync (#956).
- **Google Play policy risk (restricted permission or deceptive behaviour)** (13): Install APK (#406), Floating Widget (#455), Battery Exemption (#469), IPTV M3U (#674), Screen Recorder (#681), Floating Window (#697), Intruder Selfie (#913), Hide App Icon (#918), App Manager (#920), APK Backup (#921), Install APK (#922), Uninstall (#923), Terminal (#927).
- **device-wide file-manager feature; VidoraX manages only its own media (would need MANAGE_EXTERNAL_STORAGE)** (126): Breadcrumb Path (#744), Home Screen (#745), Internal Storage (#746), SD Card (#747), USB OTG (#748), Root Access (#749), Quick Access (#751), Tabs (#754), Dual Pane (#755), Navigation Drawer (#756), Go to Path (#757), Set Home Folder (#758), Swipe Navigation (#759), Navigation History (#760), Per-folder View (#764), Show Hidden Files (#768), Detail Columns (#769), Date Format (#773), APK Icons (#780), Copy (#781), Paste (#783), New File (#787), Drag and Drop (#792), Copy Progress (#795), Pause/Cancel Operation (#796), Operation Queue (#798), Background Tasks (#799), Secure Delete/Shred (#803), Create Shortcut (#805), Symbolic Link (#806), Recursive Search (#808), Regex Search (#813), Content Search (#814), Search History (#815), Saved Search (#816), Search Scope (#817), Fast Index (#818), Find Empty Folders (#820), Similar Images (#821), EXIF (#828), APK Info (#830), Permissions (#831), Owner (#832), Create ZIP (#836), Extract ZIP (#837), Extract RAR (#838), 7z/TAR/GZ (#839), Password Protected ZIP (#840), Browse Archive (#841), Partial Extract (#842), Compression Level (#843), Split Archive (#844), Repair Archive (#845), Add to Archive (#846), Extract To (#847), Delete After Extract (#848), Unused Apps (#854), Social App Cleaner (#857), Screenshots Cleaner (#858), Move to SD (#859), Mount/Unmount (#860), Format (#861), Storage Health (#862), Scheduled Cleaning (#863), Image Viewer (#864), Slideshow (#865), PDF Viewer (#867), Text Editor (#868), Code Viewer (#869), E-book Reader (#870), Office Docs Preview (#871), Rotate/Crop (#874), Resize Image (#875), Zoom (#876), QR Scanner (#877), Document Scanner (#878), OCR Text Extraction (#879), Merge/Split PDF (#880), File Converter (#881), Bluetooth Send (#883), Wi-Fi Direct (#884), Hotspot Transfer (#885), QR Pairing (#886), FTP Server (#887), HTTP Share (#888), Transfer Speed (#889), Transfer History (#890), Share via Link (#891), Send via Email (#892), Share Folder (#893), Received Files Folder (#894), Malware Scan (#914), Permission Prompt (#915), App Size (#924), System Monitor (#925), Battery Info (#926), Widget (#928), Device Info (#929), File Recovery (#935), Rules (#938), Smart Collections (#942), Auto Date Folders (#943), Watch Folder (#944), Compare Folders (#955), Operation Log (#957), File History (#958), Versions (#959), Quick Look (#960), Floating Action Button (#962), Keyboard Shortcuts (#963), Mouse Support (#964), Split Files (#965), Join Files (#966), Hex Viewer (#967), Preserve Timestamps (#968), Card Speed Test (#969), Fake Capacity Check (#970), Find Empty Files (#971), Clipboard History (#974), Quick Share Bar (#975), Album Manager (#976), Custom Sidebar (#978), Guest Mode (#982), Read-only Mode (#983), Remove Lock (#984), Change Owner (#985).
- **outside VidoraX (browser + video downloader + player)** (76): Move Tab to New Window (#16), Image Search (#32), Bookmarks Bar (#81), Memory Monitor (#190), Inspect Element (#222), Console (#223), Network Tab (#224), View Source (#225), Device Emulation (#227), Remote Debugging (#228), Performance Profiler (#229), Storage Inspector (#230), Security Panel (#231), News Feed (#244), Keyboard Shortcuts (#246), Install Web App (#250), Save to Notes (#252), Cloud Print (#256), Language Detection (#263), Quick Form Fill (#274), Speed Test (#275), Draw on Page (#279), Download Images (#280), Copy Text from Image (#281), Voice Commands (#282), Lightweight Home (#285), Tab Group History (#288), Page Change Alert (#289), FTP Download (#304), Multi-source/Mirror (#347), Link Polling (#362), RSS Download (#363), Playlist Download (#368), Select from Playlist (#369), Comments Download (#380), Extract Archive (#407), Virus Scan (#408), Malware Warning (#461), Pattern Download (#485), Site Grabber (#486), Automation API (#499), Browser Extension Bridge (#500), CLI (#501), Update Detection (#504), Include/Exclude Rules (#505), Cooldown Between Files (#506), Beginner Mode (#516), Advanced Mode (#517), Foldable Support (#578), TV Mode (#579), DVD/Blu-ray Folder (#614), Play Corrupted File (#615), Artist/Album/Genre (#623), Skip Corrupt Track (#662), DLNA/UPnP (#665), SMB/FTP Access (#666), Screen Mirroring (#668), Buffer Size (#669), Watermark (#683), Kids Mode (#688), Parental PIN (#690), Keyboard Shortcuts (#702), Chapters (#706), One-hand Mode (#710), Headphone Profile (#717), Multi-room Audio (#719), Remote App (#720), OTG Playback (#725), Video Notes (#727), TV Series Grouping (#732), Skip Intro (#734), Video Enhancement (#735), Podcast Subscriptions (#737), Fallback Decoder (#738), Split Screen (#739), 360 Video (#740).
- **Android/the system or keyboard already provides it** (13): Scroll Speed (#53), DNS over HTTPS (#132), Color Filters (#179), Night Light (#180), Brightness Control (#181), Spell Check (#237), Auto Update (#242), Urdu Input Support (#271), Shutdown When Done (#357), Exit When Done (#358), Safe Volume Warning (#716), Output Device (#718), Blue Light Filter (#723).
- **security-sensitive (credential storage or weaker TLS/sandbox)** (21): Anti-Fingerprinting (#131), Built-in VPN (#133), Proxy Settings (#134), WebRTC Leak Protection (#136), Save Password (#138), Password Manager (#139), Password Autofill (#140), Suggest Strong Password (#141), Authenticate to View (#142), Import/Export Passwords (#143), Password Checkup (#144), Address Autofill (#145), Payment Autofill (#146), Contact Autofill (#147), Passkey Support (#148), 2FA Code Fill (#149), Never Save List (#150), Proxy Support (#441), SOCKS Proxy (#442), SSL Verification (#445), Saved Credentials (#487).
- **needs an online service** (23): Trending Searches (#58), Breach Alert (#137), Page Compression (#186), Lite Mode (#188), Smart Tab Grouping (#258), Tab Timeline (#259), Page Summary (#260), Highlight and Annotate (#261), Weather Widget (#266), Quick Converter (#267), Address Bar Calculator (#268), Dual Calendar (#269), Prayer Times Widget (#270), VPN Location (#286), Source Reputation (#514), Online Subtitle Search (#591), Auto Captions (#713), Subtitle Translation (#714), Speech to Text (#715), Metadata Scraper (#731), AI Search (#979), Smart Rename (#980), Cleanup Suggestions (#981).
- **music-player feature; VidoraX is video-first** (22): Fade In/Out (#559), Album Art (#637), Tag Editor (#638), Lyrics Display (#639), Synced Lyrics (#640), Fetch Lyrics (#641), Gapless Playback (#642), Crossfade (#643), Music Alarm (#645), ReplayGain (#646), FLAC/ALAC/WAV (#647), Audio Formats (#648), CUE Sheet (#649), Waveform (#650), Visualizer (#651), Audio Cutter (#652), Set as Ringtone (#653), Podcast/Audiobook Mode (#654), Audio Bookmark (#655), Internet Radio (#656), Song Recognition (#657), Music Widget (#660).
- **depends on device hardware/decoders; nothing to add app-side** (8): Contrast/Saturation (#571), Video Filters (#572), HDR Support (#577), AV1 Support (#607), SW Decoder (#609), 4K/8K (#611), HDR Tone Mapping (#612), DTS/Dolby (#613).
- **little value on a phone browser/downloader** (10): Auto Scroll (#54), Page Preloading (#55), Tab Volume (#220), Web Push Notifications (#253), Disk Cache (#344), Low Memory Mode (#348), Buffer Size (#350), Multi-network Download (#446), Subtitle Editor (#604), Battery Saver (#699).
- **browser extensions: large attack surface, out of scope** (9): Extensions in Incognito (#110), Extension Store (#194), Enable/Disable (#195), View Permissions (#196), Auto Update Extensions (#197), Remove Extension (#198), User Scripts (#199), Load Unpacked Extension (#200), Extension Shortcuts (#201).
