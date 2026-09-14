# Week 8.5 Phase 3 — Legal Freeze

**Status:** Engineering freeze after Phase 3B.3 automated certification.  
**Scope:** Privacy/Terms content structure, legal renderer, legal config metadata, Settings Legal navigation, About legal links.

## Frozen

Do not change the following except for legal review, a reproduced defect, a policy/product change, or real production URLs/contact:

| Area | Location |
|------|----------|
| Legal content structure | `src/legal/privacy-content.ts`, `src/legal/terms-content.ts`, `src/legal/types.ts` |
| Privacy/Terms rendering | `src/screens/legal/LegalDocumentView.tsx`, `src/screens/legal/document/*` |
| Legal config metadata | `src/legal/config.ts` |
| Settings Legal navigation | `src/screens/settings/components/LegalSection.tsx` |
| About legal links | `src/screens/legal/AboutScreen.tsx` Help & Legal rows |

## Future production configuration (not set yet)

| Item | Current | When ready |
|------|---------|------------|
| Public domain / website | `https://vidorax.app` | Confirm live domain |
| Public Privacy / Terms pages | URLs reserved; `publicWebPublished: false` | Ship `/privacy` + `/terms`, then set `publicWebPublished: true` |
| Privacy / support contact email | `null` | Set `legalConfig.contact.*` to production mailboxes only |
| Play Store listing URL | `PLAY_STORE_LISTING_URL = null` in `app-identity.ts` | Set real listing before enabling Rate / store update actions |

## Public-web readiness

Structured documents (`legalDocuments` / `getLegalDocument`) + EN/UR localization keys can power future `/privacy` and `/terms` without rewriting policy prose. Do not build web pages in Phase 3.

## Version / build (About)

- Config-derived via `getAppIdentityMetadata()`.
- Standalone Android: prefer native build / `versionCode`.
- Expo Go: native build may reflect the Expo Go host — not final release certification.
