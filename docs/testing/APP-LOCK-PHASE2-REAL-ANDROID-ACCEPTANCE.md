# App Lock Phase 2 — Real Android Acceptance

Package: `com.anonymous.vidorax`  
**APK_NOT_BUILT_BY_REQUEST**

All cases start as **NOT_TESTED**.

---

## TEST A — CHANGE PIN

**Status:** NOT_TESTED

PIN `1234` → Change PIN → current `1234` → new `5678` → confirm.

Expected: success; background; `1234` fails; `5678` works; Phase 1 recovery still valid.

---

## TEST B — WRONG CURRENT PIN

**Status:** NOT_TESTED

Wrong current PIN on Change PIN → rejected; old PIN still works.

---

## TEST C — FORGOT PIN

**Status:** NOT_TESTED

Lock → Forgot PIN → valid recovery → new PIN → unlock.

---

## TEST D — WRONG RECOVERY

**Status:** NOT_TESTED

Wrong recovery → remain LOCKED; no private UI.

---

## TEST E — LOST BOTH

**Status:** NOT_TESTED

No PIN, no recovery → no VidoraX bypass.

---

## TEST F — RECOVERY ROTATION

**Status:** NOT_TESTED

Generate New Recovery Code → PIN → save ack → old recovery fails; new works.

---

## TEST G — INTERRUPT RECOVERY ROTATION

**Status:** NOT_TESTED

Show new code → force-close before ack → old recovery still works.

---

## TEST H — DISABLE

**Status:** NOT_TESTED

Wrong PIN keeps ON; correct PIN + confirm disables; kill/reopen → no lock screen.

---

## TEST I — PIN THROTTLE

**Status:** NOT_TESTED

Repeated wrong PIN → temporary delay; after delay correct PIN works; no wipe.

---

## TEST J — THROTTLE PROCESS RESTART

**Status:** NOT_TESTED

During delay, kill app, reopen → delay still respected.

---

## TEST K — RECOVERY THROTTLE

**Status:** NOT_TESTED

Repeated wrong recovery → temporary delay; still LOCKED.

---

## TEST L — BACKGROUND DURING CHANGE PIN

**Status:** NOT_TESTED

Sensitive Change PIN input → Home → Lock Screen; form not reusable.

---

## TEST M — BACKGROUND DURING RECOVERY

**Status:** NOT_TESTED

Forgot flow → background → return → still LOCKED; no private UI.

---

## TEST N — DOWNLOAD INDEPENDENCE

**Status:** NOT_TESTED

Large download continues across lock/change PIN/unlock.

---

## TEST O — COLD START REGRESSION

**Status:** NOT_TESTED

Force kill with lock enabled → Lock Screen first; no private flash.
