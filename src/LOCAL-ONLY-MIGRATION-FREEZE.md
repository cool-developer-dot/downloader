# VidoraX Local-Only Migration Freeze

**Status:** Local-only production codebase clean (automated).  
**Branch:** `migration/local-only`  
**Automated:** Verified (`npm run verify:local-only-final`)  
**Device runtime matrix:** Separate from this freeze  
**Cloud backend package:** Removed from this working tree (archived elsewhere)

## Frozen contracts

Do not change the following except for a reproduced defect, release requirement, or explicit new product feature:

| Area | Location / contract |
|------|---------------------|
| Local download catalog | SQLite catalog + seed / ID preservation |
| Local analyze | `src/downloads/analyze/**` — no VidoraX `/downloads/analyze` |
| Local Library | Device FS + catalog; no remote library enrichment |
| Local folders / favorites | SQLite repositories + local stores |
| Local playback namespace | `PLAYBACK_LOCAL_NAMESPACE = 'local'` + migration |
| Local settings / history / bookmarks | MMKV + SQLite; no cloud sync |
| Auth-free startup | Splash → Onboarding? → Home; no JWT / login gate |
| Settings hierarchy | Appearance → General → Downloads → Storage → Support → Legal |
| Support architecture | Static FAQ + mailto report (no ticket API) |
| Local-only legal model | Privacy/Terms device-local claims; no account/JWT |
| No-backend production config | No required `API_BASE_URL`, health, or VidoraX WS |
| No server package | This repo has no Express/Prisma/Postgres/Render deploy surface |

## Allowed external network (not frozen away)

- Browsing third-party websites
- Fetching media from origins the user chooses
- Optional support email (mailto) when configured
- Optional Play Store rate / update when listing URL is set

## Verification

```bash
cd mobile
npm run verify:local-only-final
npx expo export --platform android
```

## Final status rules

| Condition | Status label |
|-----------|--------------|
| Automated suite passes; device matrix incomplete | LOCAL-ONLY PRODUCTION CODEBASE CLEAN · Runtime Certification Pending |
| Device matrix also passes | VidoraX Local-Only Migration — Production Certified |
| Device matrix passes; no legacy APK upgrade | Production Runtime Certified · Legacy Upgrade Certification Pending |
