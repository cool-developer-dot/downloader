# App Lock Phase 1 — Architecture

## 1. Feature scope

Local-only PIN App Lock for VidoraX (Android). Protects private UI after enable. No biometrics, no backend, no cloud account, no Forgot PIN UI in Phase 1.

## 2. No-backend architecture

All configuration lives in on-device `expo-secure-store` under a single versioned JSON key. Runtime state is in-memory Zustand only. Downloads continue independently of UI lock.

## 3. Public states

| Status | Meaning |
|--------|---------|
| `DISABLED` | App Lock not configured |
| `LOCKED` | Enabled; PIN required before private UI use |
| `UNLOCKED` | Enabled; current session verified |

Internal: `isBootstrapped`, `gateMode`, `privateUiMounted`.

## 4. Bootstrap

On `(app)` mount, `AppLockGate` calls `bootstrap()`:

- Missing record → `DISABLED`, mount private UI
- Valid enabled record → `LOCKED`, do not mount private UI until unlock
- `enabled:true` but incomplete/invalid → `gateMode=integrity_error` (**fail closed**, never silent DISABLED)
- SecureStore read throw → `gateMode=secure_store_error` (**fail closed**, retry)

Never default to `UNLOCKED` before SecureStore resolves.

## 5. SecureStore model

Single key: `vidorax.appLock.v1`

```json
{
  "enabled": true,
  "schemaVersion": 1,
  "pinSalt": "<hex>",
  "pinVerifier": "<sha256 hex>",
  "recoverySalt": "<hex>",
  "recoveryVerifier": "<sha256 hex>"
}
```

One atomic write on setup commit. Plain PIN and recovery code are never stored.

## 6. PIN verifier model

- PIN: exactly 4 digits (`0000`–`9999` allowed)
- Salt: 16 random bytes (hex)
- Verifier: `SHA-256("v1|pin|{saltHex}|{pin}")`
- Compare: length-checked XOR fold (JS cannot guarantee true constant-time)

## 7. Recovery Code verifier model

- Alphabet: 31 unambiguous chars (no `0/O/1/I/L`)
- Body length: 26 chars → entropy ≈ **128.81 bits** (`26 × log2(31)`)
- Format: `XXXX-XXXX-XXXX-XXXX-XXXX-XXXX-XX`
- Verifier: `SHA-256("v1|recovery|{saltHex}|{normalizedCode}")`
- API: `verifyRecoveryCode(input)` ready for Phase 2 (no Phase 1 UI)

## 8. Setup transaction

1. Settings → Privacy → App Lock ON → `/app-lock-setup`
2. Set PIN → Confirm PIN (must match)
3. Generate recovery code + verifiers **in memory only**
4. Show recovery once (optional Copy; no auto-copy)
5. User checks “I've saved my recovery code”
6. Commit single SecureStore JSON → `enabled=true` → session `UNLOCKED`

Toggle stays OFF until commit succeeds.

## 9. Interrupted setup

Kill/cancel before acknowledgement → no SecureStore write → remains `DISABLED`. Next launch safe to restart setup. Non-enabled discardable junk is cleaned; **corrupt enabled** records are **not** wiped to DISABLED.

## 10. Lifecycle lock

`useAppLockLifecycle`: when enabled and AppState leaves `active` → `lock()` immediately. No timers. No quick-return unlock.

## 11. Root lock gate

[`src/app/(app)/_layout.tsx`](../../src/app/(app)/_layout.tsx):

`ProtectedRouteGuard` → `AppLockGate` → Stack

Cold `LOCKED`: LockScreen only (Stack not mounted).  
Warm `LOCKED`: opaque LockScreen overlay; Stack stays mounted underneath (browser continuity).

## 12. No-private-content-flash

Bootstrap gate uses splash Deep Olive until SecureStore resolves. Private Stack mounts only after `DISABLED` or first unlock (`privateUiMounted`).

## 13. Wrong-PIN behavior

Remain `LOCKED`, clear local PIN input, show incorrect-PIN error. Never modify/delete verifiers. Never fail open on crypto/storage errors.

## 14. Downloader isolation

App Lock modules must not import download engine/worker/scheduler/pause-resume. Lock is UI-only. Background downloads and notifications continue per existing behavior.

## 15. Settings integration

Existing [`SettingsScreen`](../../src/screens/settings/SettingsScreen.tsx) + new `PrivacySection` (preferences). Legal → Privacy Policy unchanged. No second Settings root.

## 16. Security boundaries

- No biometrics / Face ID / fingerprint
- No FLAG_SECURE in Phase 1 (Android Recents may still show a snapshot — documented limitation)
- No PIN/recovery/salt/verifier logging
- Disable requires current PIN + confirmation (not from Lock Screen)
- Corrupt enabled config fails closed with retry UI

## 17. Phase 2 extension points

- Forgot PIN → `verifyRecoveryCode` → set new PIN
- Change PIN / regenerate recovery
- Optional brute-force lockout
- Optional FLAG_SECURE if product requires it

## 18. Real Android acceptance plan

See [`../testing/APP-LOCK-PHASE1-REAL-ANDROID-ACCEPTANCE.md`](../testing/APP-LOCK-PHASE1-REAL-ANDROID-ACCEPTANCE.md).
