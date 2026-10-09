# Working while VidoraX is in testing

Testers have VidoraX 1.0.0 (versionCode 1), tag `v1.0.0-test1`. New work and tester fixes live on separate branches so
neither can break the other.

## Branches

| Branch | Holds | Rules |
| --- | --- | --- |
| `release/1.0` | The tested build plus fixes from tester feedback | Small fixes only, by pull request. Every Play build comes from here |
| `main` | All new work (Phase 16, the downloader plan) | Merged by pull request from feature branches; must always build |
| `dl/<ID>-<name>`, `fix/<issue>-<name>` | One work package or one fix | Branch from `main` (new work) or `release/1.0` (tester fix) |

`phase14-cloud-sync` and `overhaul` are history; don't build on them.

## A tester reports something

1. Log it as a GitHub issue: device, Android version, app version, steps, screenshot. Label it `bug`, `change` or
   `question`.
2. Triage once or twice a week:
   - Crash, lost data, a download that fails, a Play policy problem → fix on `release/1.0` now.
   - Small text or layout change → `release/1.0` if cheap, otherwise schedule on `main`.
   - New feature idea → backlog (`docs/ROADMAP.md`); never into a test build.
3. Fix on `fix/<issue>-<name>` from `release/1.0`, pull request into `release/1.0`, then the same day copy it to
   `main`: `git checkout main && git cherry-pick -x <commit>`.

## Shipping a new test build

1. On `release/1.0`, raise `versionCode` (and `versionName` if you like) in **both** `android/app/build.gradle` and
   `app.json`.
2. `bash scripts/release/check-release.sh` — refuses a dirty tree, a reused or lower versionCode, mismatched versions,
   or a missing upload key.
3. Build with `bash scripts/dev/gradle.sh :app:bundleRelease`.
4. **Upgrade test:** install it over the previous test build on a device that already has downloads, favorites,
   history and App Lock. Everything must still be there.
5. Tag it (the message must contain `versionCode N` — the check script reads it), push branch and tag, upload the AAB to
   the same Play testing track.

## Never

- Build a Play AAB from `main`, a feature branch or uncommitted code.
- Reuse a versionCode or lower it.
- Sign with anything but the upload key in `~/.vidorax-signing` (testers could not update).
- Change or drop a database table in place: add a new schema version with a migration that is safe to run twice.
- Let a half-built feature show in a build: keep it behind a setting that is off by default until it is done.
- Ship a new permission or foreground service without its Play Console declaration in the same release.

## Google Play tracks

Internal testing (team, up to 100 people) → closed testing (outside testers) → production with a staged rollout
(10 % → 50 % → 100 %). A personal developer account created after November 2023 needs at least 12 testers opted in to
closed testing for 14 days in a row before production access.
