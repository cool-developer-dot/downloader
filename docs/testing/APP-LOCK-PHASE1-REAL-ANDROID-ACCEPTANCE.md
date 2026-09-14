# App Lock Phase 1 — Real Android Acceptance

Package: `com.anonymous.vidorax`  
Platform: Android only  
APK build: **APK_NOT_BUILT_BY_REQUEST** (do not run gradle assemble / eas build / expo export / expo prebuild for this phase)

All runtime cases start as **NOT_TESTED**.

---

## TEST A — ENABLE

**Status:** NOT_TESTED

Fresh App Lock disabled.

Settings → Privacy → App Lock ON → Set PIN `1234` → Confirm `1234` → Recovery Code shown → “I've saved my recovery code”.

**Expected:** App Lock ON.

---

## TEST B — MISMATCH

**Status:** NOT_TESTED

PIN `1234`, Confirm `1235`.

**Expected:** mismatch error; lock not committed; no corrupted config.

---

## TEST C — BACKGROUND

**Status:** NOT_TESTED

App Lock enabled and unlocked → Home → return to VidoraX.

**Expected:** Lock Screen immediately; no private-content flash.

---

## TEST D — WRONG PIN

**Status:** NOT_TESTED

Enter `9999`.

**Expected:** Incorrect PIN; remain locked; input resets; private app hidden.

---

## TEST E — CORRECT PIN

**Status:** NOT_TESTED

Enter configured PIN.

**Expected:** unlock; normal app restored.

---

## TEST F — PROCESS DEATH

**Status:** NOT_TESTED

Enable App Lock → force-stop → reopen.

**Expected:** Lock Screen; correct PIN unlocks.

---

## TEST G — DOWNLOAD CONTINUES

**Status:** NOT_TESTED

Start large download → lock/background → return → unlock.

**Expected:** Lock Screen while locked; download continues per normal downloader behavior (no App Lock pause/cancel).

---

## TEST H — INTERRUPTED SETUP

**Status:** NOT_TESTED

Reach Recovery Code screen → do **not** acknowledge → force close → reopen.

**Expected:** App Lock NOT half-enabled; setup can restart safely.

---

## TEST I — CANCEL SETUP

**Status:** NOT_TESTED

Start setup → Cancel before commit.

**Expected:** App Lock OFF; no active PIN configuration.

---

## TEST J — UI PRIVACY

**Status:** NOT_TESTED

Enabled → background → foreground.

**Expected:** no Browser/Downloads/Library content visible before Lock Screen.

---

## TEST K — SETTINGS INTEGRATION

**Status:** NOT_TESTED

**Expected:** existing Settings layout preserved; App Lock under Privacy preferences; no duplicate Settings page.

---

## TEST L — DISABLE WITH PIN

**Status:** NOT_TESTED

Settings → App Lock OFF → enter current PIN → confirm disable.

**Expected:** App Lock OFF; SecureStore record removed; Lock Screen cannot disable.

---

## TEST M — CORRUPT / SECURE STORE ERROR (device rare)

**Status:** NOT_TESTED

If SecureStore fails to read while lock was enabled: private UI must not appear; retry UI shown.
