# Contributing

## Basics

- Branch from `main`
- Keep changes focused and minimal
- Do not commit secrets, `.env` files, build outputs, APKs/AABs, or `node_modules`
- Preserve the hand-maintained `android/` native source

## Before opening a PR

```bash
npx tsc --noEmit
```

Run the verifiers relevant to your change (see `package.json` `verify:*` scripts).

## Native / Android rules

- **Never** run `npx expo prebuild`
- After Kotlin/native changes, reinstall with `npx expo run:android`
- Do not ignore or remove custom packages under `android/app/src/main/java/com/anonymous/vidorax/`

## Do not add

- Backend/server/database code
- Production signing keys or credential JSON
- Generated Gradle / Expo build caches
