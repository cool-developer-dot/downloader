## What and why

<!-- Work package ID (e.g. F1, H3) or tester issue number, and what this changes. -->

## Target branch

- [ ] `main` — new work
- [ ] `release/1.0` — tester fix (copy it to `main` with `git cherry-pick -x` after merging)

## Checklist

- [ ] `npm test`, `npm run typecheck` and `npm run lint` pass; native tests run with `--rerun` if Kotlin changed
- [ ] New labels in English and Urdu, Urdu layout checked
- [ ] No database table changed in place; any schema change has a migration that is safe to run twice
- [ ] Unfinished features are behind a setting that is off by default
- [ ] No new permission or foreground service, or its Play Console declaration is noted below
- [ ] Checked on a device or emulator (release build for engine changes)

## Notes for the reviewer
