# VidoraX Automation API (P6 #499) — Tasker, Automate, MacroDroid and other apps

Other apps on the phone can add links, pause or resume every download, and hear when a download finishes. Everything
is **ignored** until the user turns on **Settings → Downloads → Remote control & other apps → "Allow other apps to
control downloads"** (off by default). No permission is needed and nothing leaves the phone.

## Intents VidoraX receives

Send them as a **broadcast** to the package `com.vidorax.fast.videodownloader` (Android delivers broadcasts to an app
only when the package is named).

| Action | Extras | What happens |
| --- | --- | --- |
| `com.vidorax.action.ADD_DOWNLOAD` | `url` (String) — or `android.intent.extra.TEXT` containing a link, or the intent's data URI | The link is checked like a pasted link (Batch Add) and, when it holds one verified video, added at the default quality. YouTube, DRM, audio-only and private addresses are refused. If VidoraX isn't open, the link waits (up to 50) and is checked the next time it is. |
| `com.vidorax.action.PAUSE_ALL` | — | Pauses every download (same as "Pause all" in the app). |
| `com.vidorax.action.RESUME_ALL` | — | Resumes every paused download. |

## Broadcast VidoraX sends

`com.vidorax.action.DOWNLOAD_COMPLETE` when a download finishes, with extras `id` (the download id) and `title`.
It never carries a URL or a file path, and is sent only while the switch is on — any app listening can read it.

## Tasker

**Add a link** (e.g. from a Share-menu task or a clipboard profile):

1. Task → **+** → *System* → **Send Intent**.
2. Action: `com.vidorax.action.ADD_DOWNLOAD`
3. Extra: `url:%CLIP` (or any variable holding the link)
4. Package: `com.vidorax.fast.videodownloader`
5. Target: **Broadcast Receiver**

**Pause all at night / resume in the morning:** the same Send Intent with Action `com.vidorax.action.PAUSE_ALL` (or
`RESUME_ALL`), Package `com.vidorax.fast.videodownloader`, Target *Broadcast Receiver*, in a *Time* profile.

**React to a finished download:** Profile → *Event* → *System* → **Intent Received**, Action
`com.vidorax.action.DOWNLOAD_COMPLETE`. In the task, `%id` and `%title` hold the extras (e.g. *Alert → Flash*
`Downloaded %title`).

## adb (testing)

```sh
adb shell am broadcast -a com.vidorax.action.ADD_DOWNLOAD -p com.vidorax.fast.videodownloader --es url https://example.com/video.mp4
adb shell am broadcast -a com.vidorax.action.PAUSE_ALL -p com.vidorax.fast.videodownloader
adb shell am broadcast -a com.vidorax.action.RESUME_ALL -p com.vidorax.fast.videodownloader
```

With the switch off, logcat shows `VidoraAutomation: ignored …: other apps may not control downloads` and nothing
changes.
