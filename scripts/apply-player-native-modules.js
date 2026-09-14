/**
 * Copies VidoraX player native modules into the Android app tree and registers the package.
 */
const fs = require('fs');
const path = require('path');

const ROOT = path.join(__dirname, '..');
const SOURCE_DIR = path.join(ROOT, 'native/android/player');
const TARGET_DIR = path.join(
  ROOT,
  'android/app/src/main/java/com/anonymous/vidorax/player',
);
const MAIN_APPLICATION = path.join(
  ROOT,
  'android/app/src/main/java/com/anonymous/vidorax/MainApplication.kt',
);

const PACKAGE_MARKER = 'com.anonymous.vidorax.player.PlayerNativePackage';

function copyNativeSources() {
  if (!fs.existsSync(SOURCE_DIR)) {
    console.warn('[vidorax] player native source dir missing — skip');
    return;
  }
  if (!fs.existsSync(path.dirname(TARGET_DIR))) {
    console.warn('[vidorax] android app tree missing — run expo prebuild first');
    return;
  }

  fs.mkdirSync(TARGET_DIR, { recursive: true });
  for (const file of fs.readdirSync(SOURCE_DIR)) {
    if (!file.endsWith('.kt')) {
      continue;
    }
    fs.copyFileSync(path.join(SOURCE_DIR, file), path.join(TARGET_DIR, file));
  }
  console.log('[vidorax] Synced player native modules');
}

function patchMainApplication() {
  if (!fs.existsSync(MAIN_APPLICATION)) {
    console.warn('[vidorax] MainApplication.kt not found — skip player package registration');
    return;
  }

  const text = fs.readFileSync(MAIN_APPLICATION, 'utf8');
  if (text.includes(PACKAGE_MARKER)) {
    console.log('[vidorax] PlayerNativePackage already registered');
    return;
  }

  const anchor = 'add(com.anonymous.vidorax.mediadetection.MediaDetectionPackage())';
  if (!text.includes(anchor)) {
    console.warn('[vidorax] Could not locate MediaDetectionPackage anchor — skip player package registration');
    return;
  }

  const next = text.replace(
    anchor,
    `${anchor}\n          add(${PACKAGE_MARKER}())`,
  );
  fs.writeFileSync(MAIN_APPLICATION, next);
  console.log('[vidorax] Registered PlayerNativePackage in MainApplication');
}

function main() {
  copyNativeSources();
  patchMainApplication();
}

main();
