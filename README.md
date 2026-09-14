# VidoraX

Android-first React Native / Expo browser and video downloader.

VidoraX is **local-first**: downloads, library metadata, playback progress, history, bookmarks, App Lock, and settings stay on the device. A VidoraX cloud backend is **not** required for normal development or use.

## Requirements

- Node.js **20+** (LTS recommended)
- npm **10+**
- JDK **17** (Android Gradle / React Native toolchain)
- Android Studio with Android SDK
- Android emulator **or** a physical Android device
- `adb` available on your `PATH`

## Clone

```bash
git clone https://github.com/cool-developer-dot/downloader.git
cd downloader
```

## Install

```bash
npm install
```

`postinstall` applies VidoraX native integration scripts:

- `scripts/apply-webview-media-hook.js` — WebView media observation hook
- `scripts/apply-player-native-modules.js` — player native module sync / registration

Do **not** commit `node_modules/`. Re-run `npm install` after a clean clone so these hooks apply.

## Environment

```bash
cp .env.example .env
```

The current app runs without required env values. `.env` is only for optional feature flags (see `.env.example`). Do not put secrets or a backend URL in `.env`.

## Run Android (native development build)

VidoraX includes **hand-written Android Kotlin modules** (file open/share, notifications, media detection, export, intents, player).

**Expo Go is not sufficient.** You need a native development build:

```bash
npx expo run:android
```

### After the native app is installed

For JS-only iteration:

```bash
npx expo start
```

## Important project rule

**Never run:**

```bash
npx expo prebuild
```

This repository contains a maintained `android/` tree with custom native packages. Regenerating native projects with `expo prebuild` can overwrite or drop that integration.

Also avoid composite scripts that invoke `expo prebuild` (for example historical `verify:week8-day1`).

## TypeScript

```bash
npx tsc --noEmit
```

## Verification

Useful existing verifiers (from `package.json`):

```bash
npm run verify:external-file-open
npm run verify:share-completed-media
npm run verify:android-download-notifications
npm run verify:phase7b-android-file-actions
npm run verify:dynamic-general-media-engine
npm run verify:pause-resume-runtime-hardening
npm run verify:app-lock-phase1
npm run verify:app-lock-phase2
npm run verify:local-only-final
```

## Project layout

| Path | Purpose |
| --- | --- |
| `src/` | App source (browser, downloads, library, player, App Lock, theme, storage) |
| `android/` | Hand-maintained Android project + custom Kotlin modules |
| `native/` | Source copies used by postinstall native sync |
| `scripts/` | Native patch scripts + verification tooling |
| `assets/` | Icons, splash, static assets |
| `docs/` | Architecture and acceptance notes |

## Troubleshooting

- Confirm the device/emulator is visible: `adb devices`
- Ensure Android SDK and JDK 17 are installed and discoverable by Android Studio / Gradle
- After **Kotlin / native** changes, reinstall the native app: `npx expo run:android`
- For **JS-only** changes, restart Metro: `npx expo start`
- If media detection seems missing after install, re-run `npm install` so `postinstall` re-applies the WebView hook
- Do not delete or ignore the `android/` source tree

## License

See [LICENSE](./LICENSE).
