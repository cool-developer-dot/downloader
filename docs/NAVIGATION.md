# VidoraX Navigation Architecture

## Overview

VidoraX uses **Expo Router** (file-based routing) with a centralized navigation layer in `src/navigation/`. Routes are grouped by access level and guarded at the layout level.

## Route Hierarchy

```
app/
├── _layout.tsx                 # Root stack: (app) | (auth)
├── +not-found.tsx              # Auth-aware fallback redirect
│
├── (auth)/                     # Guest routes
│   ├── _layout.tsx             # GuestRouteGuard
│   ├── splash.tsx
│   ├── onboarding.tsx
│   ├── sign-in.tsx
│   ├── sign-up.tsx
│   └── forgot-password.tsx
│
└── (app)/                      # Protected routes
    ├── _layout.tsx             # ProtectedRouteGuard
    ├── profile.tsx
    ├── edit-profile.tsx
    ├── about.tsx
    ├── support.tsx
    ├── history.tsx
    ├── bookmarks.tsx
    └── (tabs)/
        ├── _layout.tsx         # Bottom tabs + exit back handler
        ├── index.tsx           # Home
        ├── browser.tsx
        ├── downloads.tsx
        ├── library.tsx
        └── settings.tsx
```

## Route Groups

| Group | Access | Guard |
|-------|--------|-------|
| `(auth)` | Guest / public | `GuestRouteGuard` — authenticated users redirect to home |
| `(app)` | Protected | `ProtectedRouteGuard` — unauthenticated users redirect to sign-in |
| `(tabs)` | Protected (nested) | Inherits app guard |

## Route Access

Defined in `src/navigation/constants/route-access.ts`:

- **Protected** — `/`, `/browser`, `/downloads`, `/library`, `/settings`, `/profile`, `/edit-profile`, `/about`, `/support`, `/history`, `/bookmarks`
- **Guest** — `/splash`, `/onboarding`, `/sign-in`, `/sign-up`, `/forgot-password`

## Startup Flow

```
Cold Start
    │
    ▼
configure-storage (AsyncStorage)
    │
    ▼
AppInitializer
    ├── Hydrate persisted stores
    ├── Restore auth session
    ├── Initialize app state
    ├── Enforce splash minimum duration
    └── resolveInitialRoute()
    │
    ▼
InitialRouteRedirect (router.replace)
    │
    ├── !onboardingComplete → /splash → /onboarding → /sign-in
    ├── onboardingComplete + !auth → /sign-in
    └── authenticated → / (home)
```

Native splash remains visible until fonts load and bootstrap completes (`AppProvider`).

## Route Guards

| Guard | Location | Behavior |
|-------|----------|----------|
| `ProtectedRouteGuard` | `(app)/_layout.tsx` | Blocks app routes until initialized + authenticated |
| `GuestRouteGuard` | `(auth)/_layout.tsx` | Redirects authenticated users away from auth screens |
| `InitialRouteRedirect` | Root `_layout.tsx` | One-shot boot redirect to resolved route |

## Transitions

Centralized in `src/navigation/config/`:

| Type | Animation | Usage |
|------|-----------|-------|
| Push | `slide_from_right` | App stack, sign-up, forgot-password |
| Fade | `fade` | Auth entry screens (splash, onboarding, sign-in) |
| Modal | `slide_from_bottom` | Modal presentation (reserved) |
| Replace | `fade` | Auth flow transitions (`replace()`) |

Factories: `createPushScreenOptions`, `createFadeScreenOptions`, `createModalScreenOptions`, `createContentStyleOptions`.

## Android Back Handling

| Context | Behavior |
|---------|----------|
| Splash / Onboarding / Sign-in | Back blocked (`useAuthBackHandler`) |
| Sign-up / Forgot password | Standard stack pop |
| Tab root | Double-tap to exit (`useTabExitBackHandler`) |
| App stack (profile, about, support) | Standard pop |
| Logout | `dismissAll()` + `replace(/sign-in)` — clears history |

## Deep Links

**Scheme:** `vidorax://`  
**Universal links:** `https://vidorax.app`

Expo Router auto-resolves deep links from the file-based route tree. Custom mapping is documented in `src/navigation/config/linking.ts`.

### Supported paths

| Deep link | Route |
|-----------|-------|
| `vidorax://` | Home |
| `vidorax://browser` | Browser tab |
| `vidorax://downloads` | Downloads tab |
| `vidorax://profile` | Profile |
| `vidorax://history` | Browser history |
| `vidorax://bookmarks` | Bookmarks |
| `vidorax://sign-in` | Sign in |

Unknown paths resolve via `resolveFallbackRoute()` in `+not-found.tsx`.

## Navigation Helpers

| Helper | Purpose |
|--------|---------|
| `navigate` / `push` / `replace` | Safe wrappers with fallback on failure |
| `logout` | Clear tokens, dismiss stack, replace to sign-in |
| `resetNavigation` | Dismiss all + replace |
| `resolveInitialRoute` | Boot-time route decision |
| `resolveFallbackRoute` | Auth-aware fallback for unknown routes |
| `resolveDeepLinkPath` | Validate and normalize deep link paths |

## Folder Structure

```
src/navigation/
├── config/           # Transitions, screen options, linking, tab bar
├── constants/        # Paths, groups, route access, secondary routes
├── components/       # InitialRouteRedirect, TabBarIcon
├── guards/           # ProtectedRouteGuard, GuestRouteGuard
├── helpers/          # Navigation API, logout, deep links, fallbacks
├── hooks/            # Android back handlers
├── modules/          # Feature route aliases (per-domain)
└── types/            # Stack/tab/modal option types
```

## Logout Flow

```
Settings → Sign Out
    │
    ▼
logout()
    ├── clearTokens()
    ├── userStore.logout()
    ├── router.dismissAll()
    └── router.replace(/sign-in)
```

## Error Handling

- All navigation actions use safe wrappers that fall back to `resolveFallbackRoute()` on failure
- `+not-found.tsx` redirects to auth-aware fallback instead of crashing
- Invalid deep links normalize and resolve to fallback
