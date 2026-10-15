# Test build 2 — tester feedback (work log)

Branch `fix/test2-tester-feedback` from `origin/release/1.0` (`3656aa8`), worktree `/Users/mac/Downloads/vidorax-test2`.
Target: VidoraX 1.0.1 (versionCode 2) for the same closed-testing track. Test1 = tag `v1.0.0-test1` (`a2c89d9`).

Feedback report: no crashes or bugs; four improvement requests (store listing text, first-launch walkthrough, store
screenshots, rating link) plus advice (support easy to find, copyright education).

## Baseline (release/1.0 before any change, 2026-10-15)

| Check | Result |
| --- | --- |
| `npm test` | 624 / 624 pass, 98 suites |
| `npm run typecheck` | 0 errors (app + test configs) |
| `npm run lint` | 0 errors, **84 warnings** (the ceiling for this branch) |
| en/ur key parity | compile-time only (`CatalogStrings<typeof en>`); no runtime parity test on `release/1.0` → added in T1 |

Open PRs at start: downloader#1 (`faran/sonnet-fixes` → main), downloader#2 (`faran/opus-engine` → main). Neither
targets `release/1.0`; left alone.

