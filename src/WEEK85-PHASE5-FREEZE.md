# Week 8.5 Phase 5 — Product Surface Freeze

**Status:** Engineering freeze after Phase 5B automated certification.  
**Scope:** Home dashboard, localization, About/legal, Support FAQ + report/context, final Settings hierarchy.

## Frozen

Do not change the following except for a reproduced defect, legal review, real production contact/store URLs, or an explicit new product requirement:

| Area | Location |
|------|----------|
| Home dashboard derivation | `src/screens/home/**` (Phase 1 contracts) |
| Localization catalogs + RTL | `src/localization/**`, language persistence via settings store |
| About / legal surfaces | `src/legal/**`, `src/screens/legal/**` |
| Support FAQ + report/context | `src/support/**`, `src/screens/support/**` |
| Final Settings hierarchy | `src/screens/settings/**` (Appearance → General → Downloads → Storage → Support → Legal) |

## Allowed post-freeze configuration

| Item | Current | When ready |
|------|---------|------------|
| Play Store listing URL | `PLAY_STORE_LISTING_URL = null` | Set real listing → enables Rate / store update |
| Support contact email / API | gated unavailable | Configure production mailbox (mailto); no ticket API |
| Legal public web | `publicWebPublished: false` | Publish `/privacy` + `/terms`, then enable |
| Password reset / change password | N/A — no VidoraX account | Local-only app; do not reintroduce cloud auth without a product decision |

## Verification

```bash
cd mobile
npx tsc --noEmit
npm run verify:week8-5-final
npx expo export --platform android
```

## Runtime certification

Automated engineering certification does **not** replace a focused device matrix (EN/Dark, UR/Light, smoke, offline). Document device results separately; do not claim production runtime certification until that matrix is performed.
