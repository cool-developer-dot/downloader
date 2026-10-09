# VidoraX 1.0.0 — Google Play submission sheet

Copy-paste answers for Play Console. Every claim below was checked against the release manifest and code
(2026-10-01). Do not add features that are not listed here.

## Release

| Field | Value |
| --- | --- |
| Package | `com.vidorax.fast.videodownloader` |
| versionCode / versionName | 1 / 1.0.0 |
| minSdk / targetSdk / compileSdk | 24 / 36 / 36 |
| Release name | `VidoraX 1.0.0` |
| Signing | Play App Signing (Google holds the app key); upload key `CN=VidoraX Upload Key, O=VidoraX Labs`, cert SHA-256 `36:B9:C6:22:D3:29:9D:01:46:F3:8A:32:74:3E:BD:53:19:58:5D:E5:3A:D2:89:57:0E:C8:F5:D2:9D:D7:B5:AF` |
| AAB | `VidoraX-1.0.0-release.aab`, 73,430,424 bytes, SHA-256 `757f3561958391fe8eafedf77c2b5caa160a1d54682c27d2658443e1f5133249` |

**Release notes (en-US)**

```
<en-US>
First release of VidoraX.
• Built-in browser with tabs, bookmarks and history
• Save videos you can already play on public web pages
• Downloads keep running in the background, with pause, resume and retry
• Private library with search, favorites, rename, share and save to Gallery
• Video player with gestures, speed control, Picture-in-Picture and resume
• Optional PIN App Lock, light/dark theme, English and Urdu
</en-US>
```

## Store listing

**App name** (≤ 30): `VidoraX`

**Short description** (≤ 80, this is 76):

```
Browse the web, save videos you can play, and watch them offline in one app.
```

**Full description:**

```
VidoraX is a private browser, video saver and player in one app.

BROWSE
• Fast built-in browser with tabs, bookmarks and history
• Paste a link or open links shared from other apps
• Can be set as your default browser

SAVE VIDEOS
• When a page is playing a video that can be saved, VidoraX shows a download button
• Choose the quality when several are available
• Supports common web video formats, including MP4, WebM and unencrypted HLS/DASH streams
• Downloads continue in the background with a progress notification
• Pause, resume, retry or cancel at any time

YOUR LIBRARY
• All saved videos in one place, with thumbnails, duration, size and source site
• Search, sort and mark favorites
• Rename, share, open with another app or save a copy to your Gallery
• Also plays videos already on your phone

PLAYER
• Clean controls with brightness, volume and seek gestures
• Playback speed, Picture-in-Picture and next / previous
• Resumes where you left off

PRIVATE BY DESIGN
• No account, no ads, no tracking
• Your downloads, history, bookmarks and settings stay on your device
• Optional PIN App Lock

Light and dark themes. English and Urdu.

Please only download content you own or have permission to save. VidoraX does not download from YouTube, does not download DRM-protected or encrypted content, and does not bypass logins or paywalls.
```

**Category:** Video Players & Editors
**Tags (suggested):** Video player, Browser, Download manager
**Support email:** `Vidoraxlabs@gmail.com`
**Website:** `https://stalwart-elf-2d4d21.netlify.app/`
**Privacy policy URL:** `https://stalwart-elf-2d4d21.netlify.app/` (make sure the page shows the privacy policy text before you submit)

## App content

| Section | Answer |
| --- | --- |
| Privacy policy | `https://stalwart-elf-2d4d21.netlify.app/` |
| Ads | **No**, the app contains no ads |
| App access | **All functionality is available without special access** (no login; App Lock is optional and set by the user) |
| Target audience | **18 and over** only. Not designed for children; no appeal to children |
| Content rating | IARC questionnaire (see below) |
| Data safety | See below: no data collected, no data shared |
| Advertising ID | **No**, the app does not use the advertising ID (`AD_ID` is absent from the final manifest) |
| Government app | No |
| Financial features | None |
| Health | None |
| News app | No |
| Account creation | No; the app has no accounts, so no account deletion URL is needed |

### Content rating (IARC) notes

- Category: **Utility, Productivity, Communication, or Other** (a browser plus video player).
- Violence, sexuality, language, controlled substances, gambling: **No**. The app itself contains none of these.
- User-generated content / chat / user-to-user communication: **No**.
- Shares the user's location: **No**.
- Digital purchases: **No**.
- **Unrestricted internet access: Yes.** VidoraX includes a general web browser, so users can open any website. Answer the browser/internet question truthfully; IARC may add an "Unrestricted internet" interactive element.

### Data safety — final answer: **No data collected, no data shared**

In the form: *Does your app collect or share any of the required user data types?* → **No**. Everything else in the
form then drops away. **Device or other IDs: not collected.** If an earlier draft of the form says "Device or other IDs → Collected (App functionality)",
change it to No; nothing in the final build supports that entry.

Evidence (release AAB above, checked 2026-10-01):

| Question | Result | How it was verified |
| --- | --- | --- |
| Does FirebaseApp initialise? | **No** | Release APK has no `google_app_id` / `gcm_defaultSenderId` / `google_api_key` / `project_id` resources (aapt2 dump). Runtime logcat at app start: `W/FirebaseApp: Default FirebaseApp failed to initialize because no default options were found` → `I/FirebaseInitProvider: FirebaseApp initialization unsuccessful`. |
| Firebase Installations ID (FID) created/sent? | **No** | Installations requires a default FirebaseApp, and none exists. No Installations/FCM log lines from the app process. |
| FCM initialised / push token registered? | **No** | expo-notifications fetches a token only in `getDevicePushTokenAsync` (and topics only on subscribe); VidoraX never calls `getDevicePushTokenAsync`, `getExpoPushTokenAsync` or topic APIs. Notifications are local only. |
| Install referrer read/sent? | **No** | The library comes from expo-application and runs only in `getInstallReferrerAsync`, which the app never calls. |
| NetInfo reachability ping? | **No** | On Android NetInfo takes reachability from the OS (`useNativeReachability`), so its `clients3.google.com` probe never runs. |
| Any traffic without the user browsing? | **None** | Clean emulator, fresh install, cold start → onboarding → home → Downloads → Settings for ~2.5 min with no page opened: the kernel per-UID traffic map (`dumpsys netstats detail` → `mAppUidStatsMap`) has **no entry for VidoraX's UID** (0 bytes), while other apps' traffic is listed. |
| Favicons | First-party only | Fixed 2026-10-01: favicons used to come from `google.com/s2/favicons?domain=<host>`, which sent the hostnames of the user's history and bookmarks to Google. They now load from the site itself (`https://<host>/favicon.ico`), and the start page shows no favicons. |
| Analytics / crash / ads SDKs | None | No such SDK in the dependency tree; no ad classes in the dex; `AD_ID` absent. |

What does go over the network, all started by the user: pages and videos the user opens in the built-in browser,
searches typed into the address bar (sent to Google Search, the browser's search engine, as in any browser), and
the downloads the user starts. Google's Data safety guidance treats this as the user's own browsing, not collection by
the developer. Downloads, library, watch progress, history, bookmarks, App Lock PIN (one-way hash) and settings stay
on the device.

## Permission declarations

### A. Photo and video permissions (`READ_MEDIA_VIDEO`, `READ_MEDIA_VISUAL_USER_SELECTED`)

Where the code uses them: **Device videos** screen (`src/screens/device-videos`,
`modules/vidorax-media/.../library/DeviceVideos.kt`). It reads MediaStore videos (read-only) so the user can play
the videos already on their phone in the VidoraX player alongside their downloads. The permission is requested only
when the user opens that screen. If refused, the list stays empty with an explanation. Android 14's "Select photos
and videos" partial access is honoured: only the videos the user picked are listed. VidoraX never modifies, uploads
or deletes device videos. On Android 12 and below the same screen uses `READ_EXTERNAL_STORAGE` (maxSdk 32).

**Core-functionality text (READ_MEDIA_VIDEO):**

```
VidoraX is a video player. Its "Device videos" screen lists every video on the phone so the user can browse and play their own video collection in the VidoraX player, with resume position, speed and Picture-in-Picture. A full, continuously updated list of the user's videos is the core of a video player, and the system photo picker, which returns only one-off selections, cannot provide it. Access is read-only, is requested only when the user opens Device videos, and videos are never uploaded, modified or deleted.
```

**READ_MEDIA_VISUAL_USER_SELECTED:** this is not a separate core use. It is Android 14's partial-access grant for
the same screen; when the user chooses "Select photos and videos", VidoraX lists only the chosen videos. If the
form asks, use: `Used only to honour Android 14+ partial media access: when the user grants access to selected videos only, the Device videos screen lists just those videos.`

> Policy note: Google only allows broad video access for apps whose core purpose needs it (a video player qualifies).
> If Play rejects the declaration, the fallback is a code change to use the Android Photo Picker for Device videos
> and drop both permissions; that is a product change, not a store-listing edit.

### B. Foreground service (`FOREGROUND_SERVICE_DATA_SYNC`, type `dataSync`)

Where the code uses it: `DownloadForegroundService` (`modules/vidorax-media/.../runner/`). When the user taps Download,
the transfer must keep going while the app is in the background or the screen is off. On **Android 14+** VidoraX
uses a *user-initiated data transfer job* (`RUN_USER_INITIATED_JOBS`); the `dataSync` foreground service is used
on **Android 8–13**, and on 14+ only if the job cannot be scheduled. It shows a persistent notification with progress and
Pause / Resume / Cancel, and stops as soon as no download is active.

- **Task type:** Data sync → *Network transfer: upload or download*.
- **Description:**

```
VidoraX downloads videos the user explicitly chooses to save. After the user taps Download, the dataSync foreground service keeps that transfer running while the app is in the background or the screen is off, with an ongoing notification that shows progress and Pause / Resume / Cancel. It runs only while a user-started download is active and stops immediately when downloads finish, are paused or are cancelled.
```

- **Impact if deferred or interrupted:**

```
The user's download would stop part-way as soon as they leave the app, and the file they asked for would not be saved until they reopen the app and retry. The user expects it to finish immediately, so it cannot be deferred.
```

- **Video (required):** screen-record: open a page with a video, then tap Download, press Home, pull down the notification shade to show the progress notification, tap Pause/Resume, then open Downloads to show the finished file. Upload it (unlisted YouTube or Drive link) and paste the link.

**`mediaPlayback` is not declared.** The manifest used to declare expo-video's `mediaPlayback` service, but no
code starts it: the player pauses when the app is backgrounded, PiP needs no foreground service, and no player sets
`staysActiveInBackground`/`showNowPlayingNotification`. It was removed on 2026-10-01 so Play does not ask for a
declaration of an unused service. If Play Console still lists a Media playback question, answer that the app
does not use it.

### C. Other declarations: none required

Checked against every permission in the final merged manifest:

| Permission / component | Declaration? |
| --- | --- |
| `INTERNET`, `ACCESS_NETWORK_STATE`, `ACCESS_WIFI_STATE`, `WAKE_LOCK`, `VIBRATE`, `POST_NOTIFICATIONS`, `RECEIVE_BOOT_COMPLETED` (resume downloads after reboot), `FOREGROUND_SERVICE` | No |
| `RUN_USER_INITIATED_JOBS` | No (not a foreground-service type) |
| `USE_BIOMETRIC` / `USE_FINGERPRINT` (from `androidx.biometric` via expo-secure-store) | No |
| `READ/WRITE_EXTERNAL_STORAGE` (maxSdk 28, "Save to Gallery" on Android 7–9) | No |
| `c2dm.permission.RECEIVE` (Firebase library in expo-notifications, inactive) | No |
| `BIND_GET_INSTALL_REFERRER_SERVICE` (install-referrer library, never called) | No |
| Launcher badge permissions (ShortcutBadger in expo-notifications) | No |
| `http`/`https` VIEW intent filters (can be default browser) | No |

Not present (the ones that *would* need forms): `QUERY_ALL_PACKAGES`, `MANAGE_EXTERNAL_STORAGE`,
`REQUEST_INSTALL_PACKAGES`, `ACCESS_*LOCATION`, `SCHEDULE_EXACT_ALARM`/`USE_EXACT_ALARM`, `USE_FULL_SCREEN_INTENT`,
`BIND_ACCESSIBILITY_SERVICE`, `BIND_VPN_SERVICE`, SMS/Call Log, `AD_ID`, other foreground-service types.

## Intellectual-property note (not a form)

Play's intellectual-property policy is strict with video downloaders. The listing and the app say plainly that users
should save only content they have rights to, and that YouTube, DRM-protected media, encrypted streams and login/paywall
bypass are refused (enforced in code). Keep screenshots free of third-party copyrighted videos and brand names.

## Graphics (`~/Downloads/VidoraX-Play-Assets/`)

| Asset | File | Spec check |
| --- | --- | --- |
| App icon | `icon-512.png` | 512×512, 32-bit RGBA PNG, 285 KB (≤ 1 MB). Copy of `~/Downloads/VidoraX_PlayStore_Icon_512.png` (left untouched) scaled 1.06× about the centre so its black corners fall outside Play's rounded mask; Play applies its own corner mask. |
| Feature graphic | `feature-graphic-1024x500.png` | 1024×500, 24-bit RGB PNG, no alpha. Made from the icon artwork, brand colours and Poppins; text "Browse. Save. Play offline." |
| Phone screenshots | `phone-screenshots/01…07-*.png` | 1350×2400 (9:16), 24-bit RGB PNG, each < 1 MB. Each is an unmodified 1080×2400 capture of the **release AAB** running on a clean Pixel 8 emulator (API 35), centred on a neutral side margin because Play rejects 20:9. Raw captures are in `phone-screenshots/raw-1080x2400/`. |

Screenshot content: 1 Browser on Wikimedia Commons *Big Buck Bunny* with the "Video available" bar; 2 Downloads;
3 Download details; 4 Player; 5 Video library (Player tab); 6 Settings; 7 Welcome (onboarding with generic icons,
"Download Supported Media", added 2026-10-01; optional). Screenshots 1–6 are unchanged by the brand cleanup (none of them
showed onboarding or Quick Access). The only videos shown are Blender Foundation open movies (*Big Buck Bunny*,
*Sintel*, CC BY).

## Brand-risk cleanup (done 2026-10-01)

- Onboarding orbit: Instagram, TikTok, Facebook, Vimeo, Dailymotion and Reddit logos replaced with generic Video, Social,
  Media, Player, Library and Private icons (plus Browser, Paste link, Download). Headline "Download Without Limits" →
  **"Download Supported Media"** (Urdu: "ڈاؤن لوڈ / معاون میڈیا"). No YouTube anywhere.
- Browser home Quick Access: favicons and brand glyphs replaced by generic glyphs; site names stay as plain-text
  shortcuts and still open the same URLs.
- Downloaded items from bare file links are titled "Download" (cosmetic).
