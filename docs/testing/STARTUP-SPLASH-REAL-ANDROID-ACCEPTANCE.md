# Startup Splash — Real Android Acceptance

**Rule:** Mark **NOT_TESTED** until verified on a real Android device / installed APK.

**APK status for this change set:** `APK_NOT_BUILT_BY_REQUEST`

## A. Blue flash

| # | Steps | Expected | Status |
|---|---|---|---|
| A1 | Force-stop app. Launch VidoraX. Observe from first visible Android frame. | NO old blue logo; NO old blue background; NO Expo/default splash flash. Native launch matches current Deep Olive + current brand mark. | NOT_TESTED |
| A2 | Native splash → React Splash 1 handoff | Continuous Deep Olive surface; no blue→olive pop; no white/black flash. | NOT_TESTED |

## B. Full 3+ splash sequence (every cold launch)

| # | Steps | Expected | Status |
|---|---|---|---|
| B1 | Cold launch #1 | Splash 1 → Splash 2 (Gateway) → Splash 3 (Trust) → Library cinematic page → app | NOT_TESTED |
| B2 | Cold launch #2 (force-stop then launch) | Same full sequence again | NOT_TESTED |
| B3 | Cold launch #3 | Same full sequence again | NOT_TESTED |

## C. Warm resume

| # | Steps | Expected | Status |
|---|---|---|---|
| C1 | Complete splash → Home. Press Android Home. Return while process alive. | Resume prior app state; NO Splash 1→2→3 restart | NOT_TESTED |

## D. Process death

| # | Steps | Expected | Status |
|---|---|---|---|
| D1 | Force-stop. Launch again. | Full Splash 1→2→3(+Library) sequence | NOT_TESTED |

## E. Session

| # | Steps | Expected | Status |
|---|---|---|---|
| E1 | Log into a website in browser. Force-stop / reopen through splash. | Splash fix does not clear CookieManager / site session (site cookie rules permitting) | NOT_TESTED |

## F. Settings

| # | Steps | Expected | Status |
|---|---|---|---|
| F1 | Set theme/settings. Restart through splash. | Setting remains; splash sequence still runs | NOT_TESTED |

## G. Navigation / back stack

| # | Steps | Expected | Status |
|---|---|---|---|
| G1 | After splash completes to Home, press Android Back | Must NOT reopen Splash 3 / Splash 2 / Splash 1 | NOT_TESTED |

## Notes

- Android 12+ always shows a system splash; it must use `#1A2517` + current `splashscreen_logo` (not Expo blue).
- `onboardingComplete` may still persist as a preference flag but must not skip cinematic splash pages.
- Warm `AppState` resume ≠ cold process start.
