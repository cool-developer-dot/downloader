# App Lock Phase 2 — Architecture

## 1. Phase 2 scope

Change PIN, Forgot PIN (recovery → new PIN), Recovery Code regeneration, secure disable (PIN + confirm), basic progressive failure throttling, Phase 1 schema-compatible extensions.

## 2. Phase 1 compatibility

Same SecureStore key `vidorax.appLock.v1` and `schemaVersion: 1`. Phase 1 records without throttle/version fields parse with defaults (`sha256-v1`, zero attempts). No forced re-setup.

## 3. Change PIN state machine

`CURRENT_PIN` (re-auth) → `NEW_PIN` → `CONFIRM` → atomic write of new `pinSalt`/`pinVerifier`. Recovery fields unchanged.

## 4. Forgot PIN state machine

`LOCKED` → Forgot → Recovery input → (auth grant in memory) → New PIN → Confirm → commit → `UNLOCKED`. Private Stack never mounts until commit succeeds.

## 5. Recovery verification

Normalize (case/separators) → derive recovery verifier → compare. Wrong → recovery throttle. Correct → `recoveryAuthGranted` only (not unlock).

## 6. Recovery PIN reset

Requires `recoveryAuthGranted`. Writes new PIN fields, clears both throttles, preserves recovery verifier, unlocks.

## 7. Recovery Code rotation

Unlocked → current PIN → generate new code in memory → show once → ack → replace recovery salt/verifier. Old recovery valid until commit.

## 8. Interrupted rotation

Kill before ack → no write → old recovery remains valid. Unmount cancels in-memory session.

## 9. Disable flow

OFF → PIN → confirm Alert → `deleteItemAsync`. Fail closed if delete throws (remain enabled).

## 10. Failure throttle policy

PIN and Recovery counters are separate.

| Attempts | Delay |
|----------|-------|
| 1–4 | 0 |
| 5 | 10s |
| 6 | 20s |
| 7+ | 30s cap |

Pure functions in `app-lock-throttle.ts`. Malformed input and storage errors do not increment.

## 11. retryAfter persistence

Stored in the same SecureStore record (`pinFailedAttempts`, `pinRetryAfter`, `recoveryFailedAttempts`, `recoveryRetryAfter`). Survives process death.

## 12. Background behavior

`lock()` clears ephemeral setup/rotation/recovery-auth state and bumps `formEpoch` so forms reset.

## 13. Storage schema evolution

Extended fields (optional on read):

- `pinVerifierVersion` / `recoveryVerifierVersion` (`sha256-v1`)
- throttle metadata above

## 14. Verifier / KDF versioning

No PBKDF2/scrypt/argon2 in dependency tree without risky new packages. Retained SHA-256 derive with explicit `sha256-v1` version for future migration. Offline PIN brute-force risk if SecureStore extracted is documented; online throttling mitigates interactive guessing.

## 15. Migration from Phase 1

`classifyAppLockPayload` / `normalizeCommittedRecord` accept Phase 1 JSON. Successful unlock / change writes full Phase 2 shape.

## 16. Root-gate recovery architecture

Forgot flow renders inside `AppLockGate` / `AppLockScreen` (`lockedSurface: 'forgot'`). Does not open private routes.

## 17. No-bypass contract

Lost PIN + lost Recovery ⇒ no in-app unlock. Only OS clear-data / uninstall.

## 18. Downloader isolation

Unchanged; security module does not import download/browser engines.

## 19. Security / privacy boundaries

No biometrics, backend, cloud recovery, FLAG_SECURE (Recents limitation remains).

## 20. Android acceptance plan

See [`../testing/APP-LOCK-PHASE2-REAL-ANDROID-ACCEPTANCE.md`](../testing/APP-LOCK-PHASE2-REAL-ANDROID-ACCEPTANCE.md).

## 21. Known limitations

- SHA-256 not a strong offline KDF for 4-digit PINs
- Wall-clock throttle (device clock changes)
- No FLAG_SECURE for Recents
- JS verifier compare not true constant-time
